import { call } from "../client.ts";
import { expandMessage } from "../expand.ts";

export async function search(query: string, opts: { json: boolean; count: number; window: number }) {
  if (!query) {
    console.error("Usage: slack search <query> [--count=N] [--window=Nh]\nModifiers: in:channel from:user after:2026-01-01 before:2026-12-31");
    process.exit(1);
  }

  const res = await call("search.messages", { query, count: opts.count, sort: "score" });
  const matches: any[] = res.messages?.matches ?? [];
  const total: number = res.messages?.total ?? 0;

  if (!matches.length) {
    if (opts.json) console.log(JSON.stringify({ total: 0, results: [] }));
    else console.log("No results.");
    return;
  }

  // Expand each result with surrounding context + thread in parallel
  const expanded = await Promise.all(
    matches.map(m => expandMessage(m.channel.id, m.ts, opts.window))
  );

  if (opts.json) {
    console.log(JSON.stringify({
      total,
      showing: matches.length,
      results: expanded.map((e, i) => ({
        id: e.id,
        channel: e.channel,
        channel_id: e.channel_id,
        user: matches[i].username,
        text: matches[i].text,
        permalink: matches[i].permalink,
        ...(opts.window > 0 ? {
          thread: e.thread,
          surrounding: e.surrounding,
        } : {}),
      })),
    }, null, 2));
    return;
  }

  console.log(`${matches.length} of ${total} results for: ${query}\n`);
  for (const [i, m] of matches.entries()) {
    const e = expanded[i];
    const channel = `#${e.channel}`;
    const ts = new Date(parseFloat(m.ts) * 1000).toLocaleString();
    console.log(`[${ts}] ${channel} — ${m.username}  (id: ${e.id})`);
    console.log(`  ${m.text}`);

    if (opts.window > 0 && e.surrounding.length) {
      console.log("  context:");
      for (const s of e.surrounding) {
        const sts = new Date(parseFloat(s.ts) * 1000).toLocaleTimeString();
        console.log(`    [${sts}] ${s.user}: ${s.text}`);
        if (s.files) for (const f of s.files) console.log(`      [file: ${f.name} (${f.filetype}) ${f.permalink}]`);
      }
    }
    if (e.thread.length) {
      console.log("  thread:");
      for (const t of e.thread) {
        const tts = new Date(parseFloat(t.ts) * 1000).toLocaleTimeString();
        console.log(`    ↳ [${tts}] ${t.user}: ${t.text}`);
        if (t.files) for (const f of t.files) console.log(`      [file: ${f.name} (${f.filetype}) ${f.permalink}]`);
      }
    }
    console.log();
  }
}
