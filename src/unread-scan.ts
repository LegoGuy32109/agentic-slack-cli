import { call } from "./client.ts";

export type UnreadConversation = {
  id: string;
  type: "channel" | "group" | "dm";
  lastRead: string;
  mentionCount: number;
};

export type UnreadThread = {
  channel: string;
  threadTs: string;
  rootUser: string;
  lastRead: string;
  latestReply: string;
};

/** Every channel, group, and DM with unread activity, from Slack's own unread cursors. */
export async function scanUnreadConversations(includeMuted: boolean): Promise<UnreadConversation[]> {
  const [counts, prefs] = await Promise.all([call("client.counts"), call("users.prefs.get")]);
  const notifPrefs: Record<string, { muted: boolean }> = JSON.parse(prefs.prefs?.all_notifications_prefs ?? "{}").channels ?? {};
  const all = [
    ...(counts.channels || []).map((c: any) => ({ ...c, type: "channel" as const })),
    ...(counts.mpims || []).map((c: any) => ({ ...c, type: "group" as const })),
    ...(counts.ims || []).map((c: any) => ({ ...c, type: "dm" as const })),
  ];
  return all
    .filter((c: any) => (c.has_unreads || c.mention_count > 0) && (includeMuted || !notifPrefs[c.id]?.muted))
    .map((c: any) => ({ id: c.id, type: c.type, lastRead: c.last_read || "0", mentionCount: c.mention_count || 0 }));
}

/**
 * Followed/mentioned threads with unread replies. This is a distinct Slack unread
 * surface from channel-level unreads (Slack's own Threads view), not cleared by
 * conversations.mark. subscriptions.thread.getView returns every followed thread
 * regardless of read state, so unread is determined client-side per thread.
 */
export async function scanUnreadThreads(maxPages = 20): Promise<UnreadThread[]> {
  const threads: UnreadThread[] = [];
  let maxTs: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    const result = await call("subscriptions.thread.getView", { limit: 50, ...(maxTs ? { max_ts: maxTs } : {}) });
    for (const thread of result.threads || []) {
      const root = thread.root_msg;
      if (!root?.channel || !root?.ts) continue;
      const lastRead = root.last_read || "0";
      if (Number(root.latest_reply || 0) > Number(lastRead)) {
        threads.push({ channel: root.channel, threadTs: root.ts, rootUser: root.user || "", lastRead, latestReply: root.latest_reply });
      }
    }
    if (!result.has_more) break;
    maxTs = result.max_ts;
  }
  return threads;
}
