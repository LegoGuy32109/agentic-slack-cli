import { call, resolveUsers } from "../client.ts";

type RawMessage = {
  ts: string;
  user?: string;
  bot_id?: string;
  text: string;
  reply_count?: number;
  thread_ts?: string;
  subtype?: string;
  attachments?: any[];
  blocks?: any[];
};

type ParsedMessage = {
  ts: string;
  user: string;
  text: string;
  thread: boolean;
  fields?: { title: string; value: string }[];
  footer?: string;
};

type ChannelResult = {
  id: string;
  name: string;
  type: "channel" | "dm" | "group";
  messages: ParsedMessage[];
};

// Extract structured content from bot attachments/blocks when text is empty
function extractAttachmentContent(msg: RawMessage): {
  fields?: { title: string; value: string }[];
  footer?: string;
} | null {
  if (!msg.attachments?.length) return null;

  const fields: { title: string; value: string }[] = [];
  let footer: string | undefined;

  for (const att of msg.attachments) {
    if (att.author_name) {
      fields.unshift({ title: "from", value: att.author_name });
    }
    if (att.pretext) fields.push({ title: "", value: att.pretext });
    if (att.text) fields.push({ title: "", value: att.text });
    for (const f of att.fields ?? []) {
      if (f.value) fields.push({ title: f.title ?? "", value: f.value });
    }
    if (att.footer) footer = att.footer;
  }

  return fields.length || footer ? { fields, footer } : null;
}

export async function unread(opts: { json: boolean; threads: boolean; all: boolean }) {
  // 1. Get unread convos + muted channel list in parallel
  const [counts, prefs] = await Promise.all([
    call("client.counts"),
    call("users.prefs.get"),
  ]);

  const notifPrefs: Record<string, { muted: boolean }> =
    JSON.parse(prefs.prefs?.all_notifications_prefs ?? "{}").channels ?? {};

  const allConvos = [
    ...(counts.channels || []).map((c: any) => ({ ...c, type: "channel" })),
    ...(counts.mpims || []).map((c: any) => ({ ...c, type: "group" })),
    ...(counts.ims || []).map((c: any) => ({ ...c, type: "dm" })),
  ]
    .filter((c: any) => c.has_unreads || c.mention_count > 0)
    .filter((c: any) => opts.all || !notifPrefs[c.id]?.muted);

  if (!allConvos.length) {
    if (opts.json) console.log(JSON.stringify({ unread: [] }));
    else console.log("All caught up — no unread messages.");
    return;
  }

  // 2. Fetch info + history for each in parallel
  const results: ChannelResult[] = [];

  await Promise.all(allConvos.map(async (convo: any) => {
    // Get channel name
    let name = convo.id;
    try {
      const info = await call("conversations.info", { channel: convo.id });
      const ch = info.channel;
      if (ch.is_im) {
        const u = await call("users.info", { user: ch.user });
        name = u.user.profile.display_name || u.user.real_name || u.user.name;
      } else {
        name = ch.name;
      }
    } catch { /* keep id as name */ }

    // Fetch messages since last_read
    const hist = await call("conversations.history", {
      channel: convo.id,
      oldest: convo.last_read,
      inclusive: false,
      limit: 200,
    });

    const messages: RawMessage[] = ((hist.messages || []) as RawMessage[])
      .filter(m => !m.subtype || m.subtype === "bot_message")
      .reverse();

    if (!messages.length) return;

    // Fetch thread replies if requested
    let allRaw: RawMessage[] = messages;
    if (opts.threads) {
      const parents = messages.filter(m => m.reply_count && m.reply_count > 0);
      const threadReplies = await Promise.all(parents.map(async (m) => {
        const r = await call("conversations.replies", {
          channel: convo.id,
          ts: m.ts,
          oldest: convo.last_read,
          inclusive: false,
          limit: 100,
        });
        return ((r.messages || []) as RawMessage[]).slice(1).reverse();
      }));
      allRaw = messages.flatMap(m => {
        const idx = parents.indexOf(m);
        return idx >= 0 ? [m, ...(threadReplies[idx] ?? [])] : [m];
      });
    }

    const parsed: ParsedMessage[] = allRaw.map(m => {
      const isThread = !!(m.thread_ts && m.thread_ts !== m.ts);
      const base: ParsedMessage = {
        ts: m.ts,
        user: m.user || m.bot_id || "",
        text: m.text || "",
        thread: isThread,
      };
      // Only extract attachment content for thread replies with empty text
      if (opts.threads && isThread && !m.text) {
        const extracted = extractAttachmentContent(m);
        if (extracted?.fields?.length) base.fields = extracted.fields;
        if (extracted?.footer) base.footer = extracted.footer;
      }
      return base;
    });

    results.push({ id: convo.id, name, type: convo.type, messages: parsed });
  }));

  results.sort((a, b) => a.name.localeCompare(b.name));

  // 3. Resolve all user IDs at once
  const allUserIds = results.flatMap(r => r.messages.map(m => m.user));
  const users = await resolveUsers(allUserIds);

  if (opts.json) {
    const out = results.map(r => ({
      channel: r.name,
      id: r.id,
      type: r.type,
      messages: r.messages.map(m => ({
        ts: m.ts,
        user: users[m.user] ?? m.user,
        text: m.text,
        ...(m.thread ? { thread: true } : {}),
        ...(m.fields ? { fields: m.fields } : {}),
        ...(m.footer ? { footer: m.footer } : {}),
      })),
    }));
    console.log(JSON.stringify(out, null, 2));
  } else {
    for (const r of results) {
      const prefix = r.type === "dm" ? "@" : r.type === "group" ? "⊕" : "#";
      console.log(`\n${prefix}${r.name} (${r.messages.length} unread)`);
      for (const m of r.messages) {
        const name = users[m.user] ?? m.user;
        const ts = new Date(parseFloat(m.ts) * 1000).toLocaleTimeString();
        const indent = m.thread ? "    ↳ " : "  ";
        console.log(`${indent}[${ts}] ${name}: ${m.text}`);
        if (m.fields) {
          for (const f of m.fields) {
            const label = f.title ? `${f.title}: ` : "";
            console.log(`         ${label}${f.value}`);
          }
        }
        if (m.footer) console.log(`         ${m.footer}`);
      }
    }
  }
}
