import { call } from "../client.ts";

export async function send(channelId: string, text: string, opts: { allowWrite: boolean; yes: boolean; json: boolean }) {
  if (!channelId || !text) throw new Error("Usage: slack send <channelId> <text> --allow-write --yes");
  if (!opts.allowWrite || !opts.yes) throw new Error("send requires both --allow-write and --yes.");
  const result = await call("chat.postMessage", { channel: channelId, text });
  if (opts.json) return console.log(JSON.stringify(result, null, 2));
  console.log(`Sent to ${channelId}: ${text}`);
}
