import { call, currentUserId, mentionIds, paginate, renderMentions, resolveUsers } from "../client.ts";

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
  thread: boolean;
  files?: any[];
  mentioned?: boolean;
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
    url_private: file.url_private,
    permalink: file.permalink,
  }));
}

export async function unread(opts: { json: boolean; threads: boolean; all: boolean; files: boolean; mentions: boolean }) {
  const [counts, prefs, mentionedUser] = await Promise.all([
    call("client.counts"),
    call("users.prefs.get"),
    opts.mentions ? currentUserId() : Promise.resolve(""),
  ]);
  const notifPrefs: Record<string, { muted: boolean }> = JSON.parse(prefs.prefs?.all_notifications_prefs ?? "{}").channels ?? {};
  const allConvos = [
    ...(counts.channels || []).map((convo: any) => ({ ...convo, type: "channel" as const })),
    ...(counts.mpims || []).map((convo: any) => ({ ...convo, type: "group" as const })),
    ...(counts.ims || []).map((convo: any) => ({ ...convo, type: "dm" as const })),
  ].filter((convo: any) => (convo.has_unreads || convo.mention_count > 0) && (opts.all || !notifPrefs[convo.id]?.muted));

  const processed = await mapConcurrent(allConvos, 4, async (convo: any): Promise<ChannelResult | undefined> => {
    const [info, history] = await Promise.all([
      call("conversations.info", { channel: convo.id }).catch(() => ({ channel: {} })),
      paginate("conversations.history", { channel: convo.id, oldest: convo.last_read, inclusive: false, limit: 200 }, "messages"),
    ]);
    const messages = history.filter((message: RawMessage) => !message.subtype || message.subtype === "bot_message");
    if (!messages.length) return undefined;
    const parents = messages.filter((message: RawMessage) => message.reply_count && message.reply_count > 0);
    const replies = opts.threads
      ? await mapConcurrent(parents, 4, parent => paginate("conversations.replies", { channel: convo.id, ts: parent.ts, limit: 200 }, "messages").catch(() => []))
      : [];
    const groups = messages.map((message: RawMessage) => {
      const index = parents.indexOf(message);
      const thread = index >= 0 ? replies[index] : undefined;
      return thread?.length ? thread : [message];
    });
    const selected = opts.mentions
      ? groups.filter(group => group.some((message: RawMessage) => isMention(message, mentionedUser)))
      : groups;
    const raw = selected.flat().sort((a: RawMessage, b: RawMessage) => Number(a.ts) - Number(b.ts));
    if (!raw.length) return undefined;
    const parsed = raw.map((message: RawMessage): ParsedMessage => ({
      ts: message.ts,
      userId: message.user || message.bot_id || "",
      text: message.text || "",
      thread: !!(message.thread_ts && message.thread_ts !== message.ts),
      ...(opts.files && files(message)?.length ? { files: files(message) } : {}),
      ...(opts.mentions && isMention(message, mentionedUser) ? { mentioned: true } : {}),
    }));
    return {
      id: convo.id,
      name: info.channel?.name || convo.id,
      peerId: info.channel?.is_im ? info.channel.user : undefined,
      type: convo.type,
      messages: parsed,
    };
  });
  const results = processed.filter((result): result is ChannelResult => !!result);
  const userIds = results.flatMap(result => [result.peerId || "", ...result.messages.flatMap(message => [message.userId, ...mentionIds(message.text)])]);
  const users = await resolveUsers(userIds);
  for (const result of results) {
    if (result.peerId) result.name = users[result.peerId] || result.name;
    for (const message of result.messages) message.text = renderMentions(message.text, users);
  }
  results.sort((a, b) => a.name.localeCompare(b.name));
  if (opts.json) {
    console.log(JSON.stringify(results.map(result => ({
      channel: result.name,
      id: result.id,
      type: result.type,
      messages: result.messages.map(message => ({
        ts: message.ts,
        user: users[message.userId] || message.userId,
        text: message.text,
        ...(message.thread ? { thread: true } : {}),
        ...(message.files ? { files: message.files } : {}),
        ...(message.mentioned ? { mentioned: true } : {}),
      })),
    })), null, 2));
    return;
  }
  if (!results.length) return console.log(opts.mentions ? "No unread mentions." : "All caught up — no unread messages.");
  for (const result of results) {
    const prefix = result.type === "dm" ? "@" : result.type === "group" ? "⊕" : "#";
    console.log(`\n${prefix}${result.name} (${result.messages.length} unread)`);
    for (const message of result.messages) {
      const timestamp = new Date(parseFloat(message.ts) * 1000).toLocaleTimeString();
      const marker = message.mentioned ? "@" : message.thread ? "    ↳" : "  ";
      console.log(`${marker} [${timestamp}] ${users[message.userId] || message.userId}: ${message.text}`);
      for (const file of message.files || []) console.log(`      [file: ${file.name} (${file.filetype}) ${file.permalink}]`);
    }
  }
}
