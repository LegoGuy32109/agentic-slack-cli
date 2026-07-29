import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { cacheDir } from "./config.ts";
import { call, workspaceUrl } from "./client.ts";

export type ChannelReference = { id: string; label: string };
type ChannelCache = { version: 1; updatedAt: string; channels: Record<string, { id: string; name?: string }> };

function cachePath(workspace: string) {
  const key = workspace.replace(/^https?:\/\//, "").replace(/[^a-zA-Z0-9._-]/g, "_");
  return join(cacheDir(), key, "channels.json");
}

async function load(workspace: string): Promise<ChannelCache> {
  try {
    const cache = JSON.parse(await readFile(cachePath(workspace), "utf8"));
    if (cache?.version === 1 && cache?.channels) return cache;
  } catch { /* Cache miss. */ }
  return { version: 1, updatedAt: "", channels: {} };
}

async function save(workspace: string, cache: ChannelCache) {
  const path = cachePath(workspace);
  await mkdir(join(cacheDir(), workspace.replace(/^https?:\/\//, "").replace(/[^a-zA-Z0-9._-]/g, "_")), { recursive: true, mode: 0o700 });
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(temp, `${JSON.stringify(cache, null, 2)}\n`, { mode: 0o600 });
    await rename(temp, path);
  } finally { await rm(temp, { force: true }).catch(() => {}); }
}

async function refresh(workspace: string): Promise<ChannelCache> {
  const channels: ChannelCache["channels"] = {};
  let cursor: string | undefined;
  do {
    const result = await call("conversations.list", { types: "public_channel,private_channel,mpim,im", exclude_archived: true, limit: 200, ...(cursor ? { cursor } : {}) });
    for (const channel of result.channels || []) {
      if (!channel.id) continue;
      channels[channel.id] = { id: channel.id, name: channel.name };
    }
    cursor = result.response_metadata?.next_cursor || undefined;
  } while (cursor);
  const cache = { version: 1 as const, updatedAt: new Date().toISOString(), channels };
  await save(workspace, cache);
  return cache;
}

export async function resolveChannel(value: string): Promise<ChannelReference> {
  if (/^[CDGW][A-Z0-9]+$/.test(value)) return { id: value, label: value };
  const name = value.replace(/^#/, "").toLowerCase();
  const workspace = await workspaceUrl();
  let cache = await load(workspace);
  let match = Object.values(cache.channels).find(channel => channel.name?.toLowerCase() === name);
  if (!match) {
    cache = await refresh(workspace);
    match = Object.values(cache.channels).find(channel => channel.name?.toLowerCase() === name);
  }
  if (!match) throw new Error(`Could not resolve channel "${value}". Use a visible channel name (with or without #) or a channel ID.`);
  return { id: match.id, label: match.name ? `#${match.name}` : match.id };
}
