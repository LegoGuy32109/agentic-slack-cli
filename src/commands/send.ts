import { call } from "../client.ts";

export async function send(channelId: string, text: string, opts: { allowWrite: boolean; json: boolean }) {
  if (!channelId || !text) throw new Error("Usage: slack-cli send <channelId> <text> --allow-write");
  if (!opts.allowWrite) throw new Error("send requires --allow-write.");
  const result = await call("chat.postMessage", { channel: channelId, text });
  if (opts.json) return console.log(JSON.stringify(result, null, 2));
  console.log(`Sent to ${channelId}: ${text}`);
}
