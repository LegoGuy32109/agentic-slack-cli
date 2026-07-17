import { call } from "../client.ts";

async function resolveChannel(nameOrId: string): Promise<string> {
  // Already an ID
  if (/^[CDGW][A-Z0-9]+$/.test(nameOrId)) return nameOrId;

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
    if (match) return match.id;
    cursor = res.response_metadata?.next_cursor || undefined;
  } while (cursor);

  throw new Error(`Channel not found: ${nameOrId}`);
}

export async function mark(nameOrId: string, ts: string) {
  if (!nameOrId || !ts) {
    console.error("Usage: slack mark <channel-name-or-id> <ts>");
    process.exit(1);
  }

  const channelId = await resolveChannel(nameOrId);
  await call("conversations.mark", { channel: channelId, ts });
  console.log(`Marked ${nameOrId} as read up to ${ts}`);
}
