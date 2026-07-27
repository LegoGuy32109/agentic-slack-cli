import { call, mentionIds, paginate, renderMentions, resolveUsers } from "./client.ts";

export type ExpandedFile = {
  name: string;
  filetype: string;
  url_private: string;
  permalink: string;
};

export type ExpandedMessage = {
  ts: string;
  user: string;
  text: string;
  thread_ts?: string;
  files?: ExpandedFile[];
};

export type ExpandedContext = {
  id: string;
  channel: string;
  channel_id: string;
  match: ExpandedMessage;
  thread: ExpandedMessage[];
  surrounding: ExpandedMessage[];
};

function chronological(messages: any[]): any[] {
  return [...messages].sort((a, b) => Number(a.ts) - Number(b.ts));
}

export async function expandMessage(channelId: string, ts: string, window: number): Promise<ExpandedContext> {
  const tsFloat = parseFloat(ts);
  const historyParams = {
    channel: channelId,
    oldest: String(tsFloat - window * 3600),
    latest: String(tsFloat + window * 3600),
    limit: 200,
    inclusive: true,
  };
  const [history, replies, infoRes] = await Promise.all([
    paginate("conversations.history", historyParams, "messages"),
    paginate("conversations.replies", { channel: channelId, ts, limit: 200 }, "messages").catch(() => []),
    call("conversations.info", { channel: channelId }),
  ]);
  const allMsgs = chronological(history);
  const threadMsgs = chronological(replies);
  const ids = [...allMsgs, ...threadMsgs].flatMap(message => [message.user, ...mentionIds(message.text || "")]);
  const users = await resolveUsers(ids);
  const fmt = (message: any): ExpandedMessage => ({
    ts: message.ts,
    user: users[message.user] ?? message.user ?? message.bot_id ?? "",
    text: renderMentions(message.text ?? "", users),
    ...(message.thread_ts && message.thread_ts !== message.ts ? { thread_ts: message.thread_ts } : {}),
    ...(message.files?.length ? { files: message.files.map((file: any) => ({
      name: file.name,
      filetype: file.filetype,
      url_private: file.url_private,
      permalink: file.permalink,
    })) } : {}),
  });
  const rawMatch = allMsgs.find(message => message.ts === ts) || threadMsgs.find(message => message.ts === ts) || { ts, user: "", text: "" };
  return {
    id: `${channelId}:${ts}`,
    channel: infoRes.channel?.name ?? infoRes.channel?.user ?? channelId,
    channel_id: channelId,
    match: fmt(rawMatch),
    thread: threadMsgs.filter(message => message.ts !== rawMatch.ts && message.ts !== ts).map(fmt),
    surrounding: allMsgs.filter(message => message.ts !== rawMatch.ts).map(fmt),
  };
}
