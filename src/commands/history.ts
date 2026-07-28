import { call, mentionIds, paginate, renderMentions, resolveUsers } from "../client.ts";
import { normalizeMessage } from "../message.ts";

export async function history(channelId: string, opts: { json: boolean; top?: number; afterTs?: string; content?: boolean }) {
  if (!channelId) throw new Error("Usage: slack-cli history <channelId> [--top=N | --after-ts=TS]");
  if (opts.top !== undefined && opts.afterTs) throw new Error("Use either --top or --after-ts, not both.");
  if (opts.top !== undefined && (!Number.isInteger(opts.top) || opts.top < 1)) throw new Error("--top must be a positive integer.");
  const limit = opts.top ?? 20;
  const messagesRequest = opts.afterTs
    ? paginate("conversations.history", { channel: channelId, limit, oldest: opts.afterTs, inclusive: false }, "messages")
    : call("conversations.history", { channel: channelId, limit }).then(result => result.messages || []);
  const [raw, info] = await Promise.all([
    messagesRequest,
    call("conversations.info", { channel: channelId }).catch(() => ({ channel: {} })),
  ]);
  const selected = raw
    .filter((message: any) => !opts.afterTs || Number(message.ts) > Number(opts.afterTs))
    .sort((a: any, b: any) => Number(a.ts) - Number(b.ts))
    .slice(-(opts.top ?? 20));
  const normalized = selected.map(normalizeMessage);
  const users = await resolveUsers(normalized.flatMap(message => [message.userId, ...mentionIds(message.content)]));
  const messages = normalized.map(message => ({
    id: `${channelId}:${message.ts}`,
    ts: message.ts,
    user: users[message.userId] || message.userId,
    text: renderMentions(message.text, users),
    content: renderMentions(message.content, users),
    ...(message.thread_ts ? { thread_ts: message.thread_ts } : {}),
    ...(message.attachments ? { attachments: message.attachments } : {}),
    ...(message.files?.length ? { files: message.files.map((file: any) => ({ name: file.name, filetype: file.filetype, permalink: file.permalink, url_private: file.url_private })) } : {}),
  }));
  const result = { channel: info.channel?.name || info.channel?.user || channelId, channel_id: channelId, messages };
  if (opts.json) return console.log(JSON.stringify(result, null, 2));
  console.log(`#${result.channel} (${messages.length} messages)`);
  for (const message of messages) {
    console.log(`[${new Date(Number(message.ts) * 1000).toLocaleString()}] ${message.user} (id: ${message.id})`);
    console.log(`  ${opts.content ? message.content : message.text}`);
  }
}
