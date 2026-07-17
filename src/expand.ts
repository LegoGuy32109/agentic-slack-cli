import { call, resolveUsers } from "./client.ts";

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

// Fetch thread + surrounding channel messages for a single channelId:ts
export async function expandMessage(channelId: string, ts: string, window: number): Promise<ExpandedContext> {
  const tsFloat = parseFloat(ts);

  // Surrounding channel history + thread in parallel
  const [hist, repliesRes, infoRes] = await Promise.all([
    call("conversations.history", {
      channel: channelId,
      oldest: String(tsFloat - window * 3600),  // window hours back
      latest: String(tsFloat + window * 3600),  // window hours forward
      limit: Math.min(window * 4 + 1, 200),
      inclusive: true,
    }),
    call("conversations.replies", { channel: channelId, ts, limit: 100 }).catch(() => ({ messages: [] })),
    call("conversations.info", { channel: channelId }),
  ]);

  const channelName: string = infoRes.channel?.name ?? channelId;
  const allMsgs: any[] = hist.messages ?? [];
  const threadMsgs: any[] = repliesRes.messages ?? [];

  // Collect all user IDs for batch resolution
  const allIds = [
    ...allMsgs.map((m: any) => m.user),
    ...threadMsgs.map((m: any) => m.user),
  ];
  const users = await resolveUsers(allIds);

  const fmt = (m: any): ExpandedMessage => ({
    ts: m.ts,
    user: users[m.user] ?? m.user ?? "",
    text: m.text ?? "",
    ...(m.thread_ts && m.thread_ts !== m.ts ? { thread_ts: m.thread_ts } : {}),
    ...(m.files?.length ? {
      files: m.files.map((f: any) => ({
        name: f.name,
        filetype: f.filetype,
        url_private: f.url_private,
        permalink: f.permalink,
      })),
    } : {}),
  });

  const match = fmt(allMsgs.find((m: any) => m.ts === ts) ?? { ts, user: "", text: "" });
  const surrounding = allMsgs.filter((m: any) => m.ts !== ts).map(fmt);
  const thread = threadMsgs.slice(1).map(fmt); // skip parent, already in surrounding/match

  return {
    id: `${channelId}:${ts}`,
    channel: channelName,
    channel_id: channelId,
    match,
    thread,
    surrounding,
  };
}
