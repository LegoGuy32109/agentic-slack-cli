import { call, currentUserId, mentionIds, paginate, renderMentions, resolveUsers } from "../client.ts";
import { normalizeMessage, type VisibleAttachment } from "../message.ts";
import { scanUnreadConversations, scanUnreadThreads } from "../unread-scan.ts";

type RawMessage = {
  ts: string;
  user?: string;
  bot_id?: string;
  text?: string;
  reply_count?: number;
  thread_ts?: string;
  subtype?: string;
  files?: any[];
};

type ParsedMessage = {
  ts: string;
  userId: string;
  text: string;
  content: string;
  source: "channel" | "thread";
  mentioned: boolean;
  files?: any[];
  attachments?: VisibleAttachment[];
};

type ChannelResult = {
  id: string;
  name: string;
  peerId?: string;
  type: "channel" | "dm" | "group";
  messages: ParsedMessage[];
};

async function mapConcurrent<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const output: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      output[index] = await fn(items[index]!);
    }
  }));
  return output;
}

function isMention(message: RawMessage, userId: string): boolean {
  const text = message.text || "";
  return text.includes(`<@${userId}>`) || text.includes("<!here>") || text.includes("<!channel>");
}

function files(message: RawMessage) {
  return message.files?.map(file => ({
    name: file.name,
    filetype: file.filetype,
    permalink: file.permalink,
  }));
}

function parseMessage(message: RawMessage, userId: string, source: ParsedMessage["source"]): ParsedMessage {
  const normalized = normalizeMessage(message);
  return {
    ts: message.ts,
    userId: message.user || message.bot_id || "",
    text: normalized.text,
    content: normalized.content,
    source,
    mentioned: isMention(message, userId),
    ...(files(message)?.length ? { files: files(message) } : {}),
    ...(normalized.attachments ? { attachments: normalized.attachments } : {}),
  };
}

export async function unread(opts: { json: boolean; all: boolean; content?: boolean }) {
  const requestTs = (Date.now() / 1000).toFixed(6);
  const userId = await currentUserId();
  const [conversations, unreadThreads] = await Promise.all([
    scanUnreadConversations(opts.all),
    scanUnreadThreads(),
  ]);

  const byChannel = await mapConcurrent(conversations, 4, async (convo): Promise<ChannelResult | undefined> => {
    const [info, history] = await Promise.all([
      call("conversations.info", { channel: convo.id }).catch(() => ({ channel: {} })),
      paginate("conversations.history", { channel: convo.id, oldest: convo.lastRead, inclusive: false, limit: 200 }, "messages"),
    ]);
    const topLevel = (history as RawMessage[]).filter(message => !message.subtype || message.subtype === "bot_message");
    if (!topLevel.length) return undefined;
    const parents = topLevel.filter(message => message.reply_count && message.reply_count > 0);
    const replies = await mapConcurrent(parents, 4, parent =>
      paginate("conversations.replies", { channel: convo.id, ts: parent.ts, limit: 200 }, "messages").catch(() => []));
    const expanded = topLevel.flatMap(message => {
      const index = parents.indexOf(message);
      const thread = index >= 0 ? replies[index] : undefined;
      return (thread?.length ? thread : [message]) as RawMessage[];
    });
    const raw = expanded.sort((a, b) => Number(a.ts) - Number(b.ts));
    return {
      id: convo.id,
      name: info.channel?.name || convo.id,
      peerId: info.channel?.is_im ? info.channel.user : undefined,
      type: convo.type,
      messages: raw.map(message => parseMessage(message, userId, "channel")),
    };
  });

  const byThread = await mapConcurrent(unreadThreads, 4, async (thread): Promise<ChannelResult | undefined> => {
    const [info, replies] = await Promise.all([
      call("conversations.info", { channel: thread.channel }).catch(() => ({ channel: {} })),
      paginate("conversations.replies", { channel: thread.channel, ts: thread.threadTs, limit: 200 }, "messages").catch(() => [] as RawMessage[]),
    ]);
    const unreadReplies = (replies as RawMessage[]).filter(message => Number(message.ts) > Number(thread.lastRead));
    if (!unreadReplies.length) return undefined;
    return {
      id: thread.channel,
      name: info.channel?.name || thread.channel,
      peerId: info.channel?.is_im ? info.channel.user : undefined,
      type: info.channel?.is_im ? "dm" : info.channel?.is_mpim ? "group" : "channel",
      messages: unreadReplies.map(message => parseMessage(message, userId, "thread")),
    };
  });

  // Merge channel-sourced and thread-sourced results for the same conversation
  // rather than printing the same channel twice.
  const merged = new Map<string, ChannelResult>();
  for (const result of [...byChannel, ...byThread].filter((r): r is ChannelResult => !!r)) {
    const existing = merged.get(result.id);
    if (!existing) { merged.set(result.id, result); continue; }
    const seen = new Set(existing.messages.map(m => m.ts));
    existing.messages.push(...result.messages.filter(m => !seen.has(m.ts)));
    existing.messages.sort((a, b) => Number(a.ts) - Number(b.ts));
  }
  const results = [...merged.values()];

  const userIds = results.flatMap(result => [result.peerId || "", ...result.messages.flatMap(message => [message.userId, ...mentionIds(message.content)])]);
  const users = await resolveUsers(userIds);
  for (const result of results) {
    if (result.peerId) result.name = users[result.peerId] || result.name;
    for (const message of result.messages) message.text = renderMentions(message.text, users);
    for (const message of result.messages) message.content = renderMentions(message.content, users);
  }
  results.sort((a, b) => a.name.localeCompare(b.name));

  if (opts.json) {
    console.log(JSON.stringify({
      request_ts: requestTs,
      conversations: results.map(result => ({
        channel: result.name,
        id: result.id,
        type: result.type,
        messages: result.messages.map(message => ({
          ts: message.ts,
          user: users[message.userId] || message.userId,
          text: message.text,
          content: message.content,
          source: message.source,
          ...(message.mentioned ? { mentioned: true } : {}),
          ...(message.files ? { files: message.files } : {}),
        })),
      })),
    }, null, 2));
    return;
  }

  console.log(`request_ts: ${requestTs} (pass this to \`mark <ts>\` to mark exactly what's shown here, and nothing newer)`);
  if (!results.length) { console.log("All caught up — no unread messages."); return; }
  for (const result of results) {
    const prefix = result.type === "dm" ? "@" : result.type === "group" ? "⊕" : "#";
    console.log(`\n${prefix}${result.name} (${result.messages.length} unread)`);
    for (const message of result.messages) {
      const timestamp = new Date(parseFloat(message.ts) * 1000).toLocaleTimeString();
      const marker = message.mentioned ? "@" : message.source === "thread" ? "    ↳" : "  ";
      console.log(`${marker} [${timestamp}] ${users[message.userId] || message.userId}: ${opts.content ? message.content : message.text}`);
      for (const file of message.files || []) console.log(`      [file: ${file.name} (${file.filetype}) ${file.permalink}]`);
    }
  }
}
