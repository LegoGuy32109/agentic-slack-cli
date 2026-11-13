import { call } from "../client.ts";
import { resolveChannel } from "../references.ts";
import { scanUnreadConversations, scanUnreadThreads } from "../unread-scan.ts";

function markTimestamp(value: string): string {
  if (!/^\d+(?:\.\d+)?$/.test(value) || Number(value) <= 0) {
    throw new Error(`Invalid timestamp "${value}". Use a Unix timestamp such as 1710000000.000001, typically the request_ts printed by \`slack-cli unread\`.`);
  }
  return value;
}

async function resolveIds(refs: string[]): Promise<Set<string>> {
  const resolved = await Promise.all(refs.map(ref => resolveChannel(ref)));
  return new Set(resolved.map(channel => channel.id));
}

type Outcome = { id: string; kind: "conversation" | "thread"; ok: boolean; error?: string };

/**
 * Marks read through `ts` across every currently unread channel, group, DM, and
 * followed thread (Slack's Threads view is a separate unread surface from channel
 * unreads and needs its own write, subscriptions.thread.mark). Re-scans unread
 * state at call time rather than trusting a caller-supplied list: since no write
 * here can ever move a cursor past `ts`, anything with a later timestamp, whether
 * from a conversation never shown to the caller or a message that arrived after
 * `ts` was captured, is untouched and stays unread.
 */
export async function mark(inputTs: string, opts: { only?: string[]; ignore?: string[]; allowWrite: boolean }) {
  if (!inputTs) {
    throw new Error("Usage: slack-cli mark <ts> [--only channel,channel] [--ignore channel,channel] [--allow-write]\nts is typically the request_ts printed by `slack-cli unread`.");
  }
  if (opts.only?.length && opts.ignore?.length) throw new Error("Use either --only or --ignore, not both.");
  const ts = markTimestamp(inputTs);
  const through = new Date(Number(ts) * 1000).toLocaleString();

  const [conversations, threads] = await Promise.all([scanUnreadConversations(true), scanUnreadThreads()]);
  const onlyIds = opts.only?.length ? await resolveIds(opts.only) : undefined;
  const ignoreIds = opts.ignore?.length ? await resolveIds(opts.ignore) : undefined;
  const included = (id: string) => (onlyIds ? onlyIds.has(id) : true) && (ignoreIds ? !ignoreIds.has(id) : true);

  const targetConversations = conversations.filter(convo => included(convo.id));
  const targetThreads = threads.filter(thread => included(thread.channel));

  if (!targetConversations.length && !targetThreads.length) {
    console.log("Nothing unread to mark.");
    return;
  }

  if (!opts.allowWrite) {
    console.log(`Dry run: would mark read through ${through} (ts ${ts}):`);
    for (const convo of targetConversations) console.log(`  conversation ${convo.id}`);
    for (const thread of targetThreads) console.log(`  thread ${thread.channel}:${thread.threadTs}`);
    console.log("Re-run with --allow-write to perform these Slack writes.");
    return;
  }

  const outcomes: Outcome[] = await Promise.all([
    ...targetConversations.map(async (convo): Promise<Outcome> => {
      try { await call("conversations.mark", { channel: convo.id, ts }); return { id: convo.id, kind: "conversation", ok: true }; }
      catch (error) { return { id: convo.id, kind: "conversation", ok: false, error: error instanceof Error ? error.message : String(error) }; }
    }),
    ...targetThreads.map(async (thread): Promise<Outcome> => {
      try { await call("subscriptions.thread.mark", { channel: thread.channel, thread_ts: thread.threadTs, ts }); return { id: `${thread.channel}:${thread.threadTs}`, kind: "thread", ok: true }; }
      catch (error) { return { id: `${thread.channel}:${thread.threadTs}`, kind: "thread", ok: false, error: error instanceof Error ? error.message : String(error) }; }
    }),
  ]);

  const failed = outcomes.filter(outcome => !outcome.ok);
  console.log(`Marked read through ${through} (ts ${ts}): ${outcomes.length - failed.length}/${outcomes.length} succeeded.`);
  for (const outcome of failed) console.log(`  failed: ${outcome.kind} ${outcome.id} — ${outcome.error}`);
}

export const markInternals = { markTimestamp };
