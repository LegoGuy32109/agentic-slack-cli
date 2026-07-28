import { call, currentUserIdentity, mentionIds, renderMentions, resolveUsers } from "../client.ts";
import { expandMessage } from "../expand.ts";
import { normalizeMessage } from "../message.ts";

function startOfDate(date: string, timezone: string): number {
  const [year, month, day] = date.split("-").map(Number);
  const desiredUtc = Date.UTC(year!, month! - 1, day!);
  let guess = desiredUtc;
  // Re-evaluate the offset so boundaries remain correct across DST changes.
  for (let pass = 0; pass < 2; pass++) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    }).formatToParts(new Date(guess));
    const values = Object.fromEntries(parts.filter(part => part.type !== "literal").map(part => [part.type, part.value]));
    const shownUtc = Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day), Number(values.hour), Number(values.minute), Number(values.second));
    guess = desiredUtc - (shownUtc - guess);
  }
  return guess;
}

function shiftDate(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export async function search(query: string, opts: { json: boolean; count: number; window: number; after?: string; before?: string; content?: boolean }) {
  if (!query) {
    console.error("Usage: slack search <query> [--count=N] [--window=Nh]\nModifiers: in:channel from:user|from:me after:2026-01-01 before:2026-12-31");
    process.exit(1);
  }

  const needsIdentity = query.includes("from:me") || !!opts.after || !!opts.before;
  const identity = needsIdentity ? await currentUserIdentity() : undefined;
  const queryWithAlias = query.replace(/from:me\b/g, `from:${identity?.username || identity?.id || "me"}`);
  // Ask Slack for a one-day superset, then enforce our documented local-date
  // semantics locally. Slack's native after/before boundaries are not stable enough.
  const fullQuery = `${queryWithAlias}${opts.after ? ` after:${shiftDate(opts.after, -1)}` : ""}${opts.before ? ` before:${shiftDate(opts.before, 1)}` : ""}`;
  const res = await call("search.messages", { query: fullQuery, count: opts.count, sort: "timestamp", sort_dir: "desc" });
  const afterTs = opts.after ? startOfDate(opts.after, identity?.timezone || "UTC") / 1000 : undefined;
  const beforeTs = opts.before ? startOfDate(opts.before, identity?.timezone || "UTC") / 1000 : undefined;
  const matches: any[] = (res.messages?.matches ?? []).filter((message: any) => {
    const ts = Number(message.ts);
    return (afterTs === undefined || ts >= afterTs) && (beforeTs === undefined || ts < beforeTs);
  });
  const total: number = matches.length;

  if (!matches.length) {
    if (opts.json) console.log(JSON.stringify({ total: 0, results: [] }));
    else console.log("No results.");
    return;
  }

  const expanded = opts.window > 0
    ? await Promise.all(matches.map(m => expandMessage(m.channel.id, m.ts, opts.window)))
    : [];

  const results = await Promise.all(matches.map(async (m, i) => {
    const e = expanded[i];
    const normalized = normalizeMessage(m);
    const users = await resolveUsers([normalized.userId, ...mentionIds(normalized.content)]);
    return {
      id: e?.id || `${m.channel.id}:${m.ts}`,
      channel: e?.channel || m.channel.name,
      channel_id: e?.channel_id || m.channel.id,
      user: users[normalized.userId] || m.username || normalized.userId,
      text: renderMentions(normalized.text, users),
      content: renderMentions(normalized.content, users),
      ...(normalized.attachments ? { attachments: normalized.attachments } : {}),
      permalink: m.permalink,
      ...(e ? { thread: e.thread, surrounding: e.surrounding } : {}),
    };
  }));

  if (opts.json) {
    console.log(JSON.stringify({ total, showing: results.length, results }, null, 2));
    return;
  }

  console.log(`${results.length} of ${total} results for: ${fullQuery}\n`);
  for (const result of results) {
    const ts = new Date(parseFloat(result.id.split(":")[1]!) * 1000).toLocaleString();
    console.log(`[${ts}] #${result.channel} — ${result.user}  (id: ${result.id})`);
    console.log(`  ${opts.content ? result.content : result.text}`);
    if (result.surrounding?.length) {
      console.log("  context:");
      for (const message of result.surrounding) console.log(`    [${new Date(parseFloat(message.ts) * 1000).toLocaleTimeString()}] ${message.user}: ${opts.content ? message.content : message.text}`);
    }
    if (result.thread?.length) {
      console.log("  thread:");
      for (const message of result.thread) console.log(`    ↳ [${new Date(parseFloat(message.ts) * 1000).toLocaleTimeString()}] ${message.user}: ${opts.content ? message.content : message.text}`);
    }
    console.log();
  }
}
