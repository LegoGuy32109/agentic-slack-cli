import { expandMessage } from "../expand.ts";

export async function context(ids: string[], opts: { json: boolean; window: number }) {
  if (!ids.length) {
    console.error("Usage: slack context <channelId:ts> [<channelId:ts> ...] [--window=Nh]");
    process.exit(1);
  }

  const parsed = ids.map(id => {
    const [channelId, ts] = id.split(":");
    if (!channelId || !ts) {
      console.error(`Invalid message id: ${id} (expected channelId:ts)`);
      process.exit(1);
    }
    return { channelId, ts };
  });

  const results = await Promise.all(
    parsed.map(({ channelId, ts }) => expandMessage(channelId, ts, opts.window))
  );

  if (opts.json) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  for (const r of results) {
    console.log(`\n=== #${r.channel} — ${r.id} ===`);

    console.log("\n-- surrounding --");
    for (const m of r.surrounding) {
      const marker = m.ts === r.match.ts ? ">" : " ";
      const ts = new Date(parseFloat(m.ts) * 1000).toLocaleString();
      console.log(`${marker} [${ts}] ${m.user}: ${m.text}`);
      if (m.files) for (const f of m.files) console.log(`    [file: ${f.name} (${f.filetype}) ${f.permalink}]`);
    }

    if (r.thread.length) {
      console.log("\n-- thread --");
      for (const m of r.thread) {
        const ts = new Date(parseFloat(m.ts) * 1000).toLocaleString();
        console.log(`  ↳ [${ts}] ${m.user}: ${m.text}`);
        if (m.files) for (const f of m.files) console.log(`      [file: ${f.name} (${f.filetype}) ${f.permalink}]`);
      }
    }
  }
}
