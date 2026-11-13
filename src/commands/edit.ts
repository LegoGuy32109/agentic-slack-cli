import { call, permalink, resolveMentionTokens } from "../client.ts";
import { blocksText, richBlocks, unresolvedMentionWarning } from "../message.ts";
import { jsonValueInput, prepareOperation, wireParams } from "../operations.ts";

export type EditOptions = {
  allowWrite: boolean;
  json: boolean;
  blocks?: string;
  format?: string;
};

// Slack authorizes chat.update only for the authenticated user's own messages
// (cant_update_message otherwise) and only within a channel it can still see
// the message in (message_not_found for a bad ts or wrong channel). Both
// surface as the ordinary call() error and need no special handling here.
export async function edit(channelId: string, ts: string, text: string, opts: EditOptions) {
  if (!channelId || !ts || !text) throw new Error("Usage: slack-cli edit <channelId> <ts> <text> --allow-write");
  if (opts.format && !["plain", "rich"].includes(opts.format)) throw new Error("--format must be plain or rich.");

  const resolvedText = await resolveMentionTokens(text);
  const blockInput = opts.blocks ? await jsonValueInput(opts.blocks, "--blocks") : undefined;
  const blocks = Array.isArray(blockInput) ? blockInput : (blockInput as { blocks?: unknown } | undefined)?.blocks ?? (opts.format === "rich" ? richBlocks(resolvedText) : undefined);
  if (opts.blocks && !Array.isArray(blocks)) throw new Error("--blocks must contain a JSON object with a blocks array.");
  const mentionWarning = unresolvedMentionWarning([resolvedText, blocksText(blocks)].filter(Boolean).join("\n"));

  const params = await prepareOperation("chat.update", { channel: channelId, ts, text: resolvedText, ...(blocks ? { blocks } : {}) });

  if (mentionWarning) console.error(`Warning: ${mentionWarning}`);

  if (!opts.allowWrite) {
    const result = { ok: true, dry_run: true, effect: "message", method: "chat.update", params, wire_params: wireParams(params), ...(mentionWarning ? { warning: mentionWarning } : {}) };
    return opts.json ? console.log(JSON.stringify(result, null, 2)) : console.log(`Dry run (effect: message): would edit ${params.channel} at ts ${params.ts} to: ${resolvedText}`);
  }

  const result = await call("chat.update", params);
  const receipt = {
    ok: true,
    effect: "message",
    channel: result.channel ?? params.channel,
    ts: result.ts ?? params.ts,
    permalink: await permalink(String(result.channel ?? params.channel), String(result.ts ?? params.ts)),
    ...(mentionWarning ? { warning: mentionWarning } : {}),
  };
  if (opts.json) return console.log(JSON.stringify(receipt, null, 2));
  console.log(`Edited ${receipt.channel} at ts ${receipt.ts}${receipt.permalink ? `\n${receipt.permalink}` : ""}`);
}
