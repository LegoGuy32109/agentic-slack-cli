import { call, permalink, resolveMentionTokens } from "../client.ts";
import { blocksText, richBlocks, unresolvedMentionWarning } from "../message.ts";
import { jsonValueInput, prepareOperation, wireParams } from "../operations.ts";
import { resolveChannel } from "../references.ts";
import { describeFiles, putUploadBytes, resolveShare, uploadFiles, verifyUpload, type FileDescription } from "../upload.ts";

function bytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
  return `${(size / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function describeForPreview(file: FileDescription) {
  return {
    path: file.path,
    name: file.name,
    title: file.title,
    size: file.size,
    size_human: bytes(file.size),
    sha256: file.sha256 ?? null,
    first_line: file.preview ?? null,
  };
}

export type SendOptions = {
  allowWrite: boolean;
  json: boolean;
  blocks?: string;
  format?: string;
  files?: string[];
  titles?: string[];
  threadTs?: string;
  verify?: boolean;
};

export async function send(channelId: string, text: string, opts: SendOptions) {
  const attachments = opts.files ?? [];
  if (!channelId || (!text && !attachments.length)) throw new Error("Usage: slack-cli send <channelId> <text> [--file PATH] --allow-write");
  if (opts.format && !["plain", "rich"].includes(opts.format)) throw new Error("--format must be plain or rich.");
  if (attachments.length && opts.blocks) throw new Error("--file cannot combine with --blocks. A file's message is its initial comment, which takes no blocks. Drop --blocks.");
  if (attachments.length && opts.format === "rich") throw new Error("--file cannot combine with --format rich. A file's message is its initial comment, which takes no blocks. Drop --format rich.");

  const resolvedText = await resolveMentionTokens(text);

  if (attachments.length) return sendWithFiles(channelId, resolvedText, attachments, opts, unresolvedMentionWarning(resolvedText));

  const blockInput = opts.blocks ? await jsonValueInput(opts.blocks, "--blocks") : undefined;
  const blocks = Array.isArray(blockInput) ? blockInput : (blockInput as { blocks?: unknown } | undefined)?.blocks ?? (opts.format === "rich" ? richBlocks(resolvedText) : undefined);
  if (opts.blocks && !Array.isArray(blocks)) throw new Error("--blocks must contain a JSON object with a blocks array.");
  const mentionWarning = unresolvedMentionWarning([resolvedText, blocksText(blocks)].filter(Boolean).join("\n"));
  const params = await prepareOperation("chat.postMessage", {
    channel: channelId,
    text: resolvedText,
    ...(blocks ? { blocks } : {}),
    ...(opts.threadTs ? { thread_ts: opts.threadTs } : {}),
  });

  if (mentionWarning) console.error(`Warning: ${mentionWarning}`);

  if (!opts.allowWrite) {
    const result = { ok: true, dry_run: true, effect: "message", method: "chat.postMessage", params, wire_params: wireParams(params), ...(mentionWarning ? { warning: mentionWarning } : {}) };
    return opts.json ? console.log(JSON.stringify(result, null, 2)) : console.log(`Dry run (effect: message): would send to ${params.channel}: ${resolvedText}`);
  }

  const result = await call("chat.postMessage", params);
  const receipt = {
    ok: true,
    effect: "message",
    channel: result.channel ?? params.channel,
    ts: result.ts,
    permalink: await permalink(String(result.channel ?? params.channel), result.ts),
    files: [] as unknown[],
    ...(mentionWarning ? { warning: mentionWarning } : {}),
  };
  if (opts.json) return console.log(JSON.stringify(receipt, null, 2));
  console.log(`Sent to ${receipt.channel} at ts ${receipt.ts}${receipt.permalink ? `\n${receipt.permalink}` : ""}`);
}

async function sendWithFiles(channelId: string, text: string, paths: string[], opts: SendOptions, mentionWarning?: string) {
  const described = await describeFiles(paths, opts.titles ?? []);
  const channel = await resolveChannel(channelId);
  if (mentionWarning) console.error(`Warning: ${mentionWarning}`);

  if (!opts.allowWrite) {
    // Deliberately no network beyond channel resolution. files.getUploadURLExternal
    // creates a file object, so a preview that called it would leave an orphan.
    const result = {
      ok: true,
      dry_run: true,
      effect: "file",
      channel: channel.id,
      comment: text || null,
      thread_ts: opts.threadTs ?? null,
      files: described.map(describeForPreview),
      warning: [mentionWarning, "An uploaded file outlives the message it is posted with and stays fetchable by permalink."].filter(Boolean).join(" "),
    };
    if (opts.json) return console.log(JSON.stringify(result, null, 2));
    console.log(`Dry run (effect: file): would upload ${described.length} file(s) to ${channel.label}`);
    for (const file of described) {
      console.log(`  ${file.path}`);
      console.log(`    ${bytes(file.size)}, sha256 ${file.sha256}`);
      if (file.preview) console.log(`    first line: ${file.preview}`);
    }
    if (text) console.log(`  comment: ${text}`);
    console.log("  An uploaded file outlives its message and stays fetchable by permalink.");
    return;
  }

  const uploaded = await uploadFiles({ call, put: putUploadBytes }, {
    channelId: channel.id,
    comment: text || undefined,
    threadTs: opts.threadTs,
    files: described,
  });

  // Resolving the message timestamp costs about a second of polling, because the
  // posted message is not readable back for a few seconds. Measured: the message
  // was still absent from conversations.history 1.6 s after completion. That wait
  // buys nothing on a plain send, where each file's own permalink is already in
  // the completion response, so only --verify pays it.
  const ts = uploaded.ts ?? (opts.verify ? (await resolveShare({ call }, channel.id, uploaded.files[0]!.id)).ts : undefined);
  const verification = opts.verify ? await verifyUpload({ call }, channel.id, uploaded.files, undefined, ts, opts.threadTs) : undefined;
  const receipt = {
    ok: verification ? verification.ok : true,
    effect: "file",
    channel: channel.id,
    ts,
    permalink: await permalink(channel.id, ts),
    files: uploaded.files,
    ...(verification ? { verification } : {}),
    ...(mentionWarning ? { warning: mentionWarning } : {}),
  };

  if (opts.json) {
    console.log(JSON.stringify(receipt, null, 2));
    if (verification && !verification.ok) process.exitCode = 1;
    return;
  }

  console.log(`Uploaded ${uploaded.files.length} file(s) to ${channel.label}${ts ? ` at ts ${ts}` : ""}`);
  for (const file of uploaded.files) console.log(`  ${file.name} (${bytes(file.size)}) ${file.permalink ?? file.id}`);
  if (receipt.permalink) console.log(receipt.permalink);
  if (verification) {
    for (const check of verification.checks) {
      console.log(`  verify ${check.name}: ${check.ok ? "ok" : "FAILED"} (expected ${check.expected}, Slack reports ${check.actual ?? "unknown"}, shared: ${check.shared})${check.reason ? `, ${check.reason}` : ""}`);
    }
    if (!verification.ok) process.exitCode = 1;
  }
  console.log(`Undo: slack-cli api files.delete --params '{"file":"${uploaded.files[0]?.id ?? "F..."}"}' --allow-write`);
}
