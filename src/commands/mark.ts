import { call } from "../client.ts";

type Channel = { id: string; label: string };

function markTimestamp(value: string | undefined, now = Date.now()): string {
  if (value === undefined) return (now / 1000).toFixed(6);
  if (!/^\d+(?:\.\d+)?$/.test(value) || Number(value) <= 0) {
    throw new Error(`Invalid timestamp "${value}". Use a Unix timestamp such as 1710000000.000001, or omit it to mark through now.`);
  }
  return value;
}

async function resolveChannel(nameOrId: string): Promise<Channel> {
  // Already an ID
  if (/^[CDGW][A-Z0-9]+$/.test(nameOrId)) return { id: nameOrId, label: nameOrId };

  // Resolve by name — paginate through all member channels
  const name = nameOrId.replace(/^#/, "").toLowerCase();
  let cursor: string | undefined;
  do {
    const res = await call("conversations.list", {
      types: "public_channel,private_channel,mpim,im",
      exclude_archived: true,
      limit: 200,
      ...(cursor ? { cursor } : {}),
    });
    const match = (res.channels as any[]).find(
      (c: any) => c.name?.toLowerCase() === name
    );
    if (match) return { id: match.id, label: `#${match.name}` };
    cursor = res.response_metadata?.next_cursor || undefined;
  } while (cursor);

  throw new Error(`Could not resolve channel "${nameOrId}". Use a visible channel name (with or without #) or a channel ID.`);
}

export async function mark(nameOrId: string, inputTs: string | undefined, opts: { allowWrite: boolean }) {
  if (!nameOrId) {
    throw new Error("Usage: slack-cli mark <channel-name-or-id> [ts] --allow-write\nOmit ts to mark the entire channel as read through the time this command started.");
  }
  const ts = markTimestamp(inputTs);
  const channel = await resolveChannel(nameOrId);
  const through = new Date(Number(ts) * 1000).toLocaleString();
  if (!opts.allowWrite) {
    console.log(`Dry run: would mark ${channel.label} (${channel.id}) as read through ${through} (ts ${ts}).\nRe-run with --allow-write to perform this Slack write.`);
    return;
  }

  await call("conversations.mark", { channel: channel.id, ts });
  console.log(`Marked ${channel.label} as read through ${through} (ts ${ts}).`);
}

export const markInternals = { markTimestamp };
