import { call, resolveMentionTokens } from "../client.ts";
import { jsonValueInput, prepareOperation, wireParams } from "../operations.ts";

function richBlocks(text: string) {
  const elements: any[] = [];
  const lines = text.split("\n");
  for (let index = 0; index < lines.length;) {
    const list: any[] = [];
    while (index < lines.length && /^[-*]\s+/.test(lines[index]!)) {
      list.push({ type: "rich_text_section", elements: [{ type: "text", text: lines[index]!.replace(/^[-*]\s+/, "") }] });
      index++;
    }
    if (list.length) elements.push({ type: "rich_text_list", style: "bullet", elements: list });
    else { if (lines[index]) elements.push({ type: "rich_text_section", elements: [{ type: "text", text: lines[index]! }] }); index++; }
  }
  return [{ type: "rich_text", elements }];
}

export async function send(channelId: string, text: string, opts: { allowWrite: boolean; json: boolean; blocks?: string; format?: string }) {
  if (!channelId || !text) throw new Error("Usage: slack-cli send <channelId> <text> --allow-write");
  if (opts.format && !["plain", "rich"].includes(opts.format)) throw new Error("--format must be plain or rich.");
  const resolvedText = await resolveMentionTokens(text);
  const blockInput = opts.blocks ? await jsonValueInput(opts.blocks, "--blocks") : undefined;
  const blocks = Array.isArray(blockInput) ? blockInput : (blockInput as { blocks?: unknown } | undefined)?.blocks ?? (opts.format === "rich" ? richBlocks(resolvedText) : undefined);
  if (opts.blocks && !Array.isArray(blocks)) throw new Error("--blocks must contain a JSON object with a blocks array.");
  const params = await prepareOperation("chat.postMessage", { channel: channelId, text: resolvedText, ...(blocks ? { blocks } : {}) });
  if (!opts.allowWrite) {
    const result = { ok: true, dry_run: true, method: "chat.postMessage", params, wire_params: wireParams(params) };
    return opts.json ? console.log(JSON.stringify(result, null, 2)) : console.log(`Dry run: would send to ${params.channel}: ${resolvedText}`);
  }
  const result = await call("chat.postMessage", params);
  if (opts.json) return console.log(JSON.stringify(result, null, 2));
  console.log(`Sent to ${channelId}: ${text}`);
}
