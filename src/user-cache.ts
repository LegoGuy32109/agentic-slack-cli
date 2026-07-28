import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { cacheDir } from "./config.ts";

type Identity = {
  username?: string;
  displayName?: string;
  timezone?: string;
  fetchedAt: string;
};

type UserCache = {
  version: 2;
  workspace: string;
  updatedAt: string;
  users: Record<string, string>;
  identities: Record<string, Identity>;
};

function workspaceKey(workspaceUrl: string): string {
  return workspaceUrl.replace(/^https?:\/\//, "").replace(/[^a-zA-Z0-9._-]/g, "_");
}

function pathFor(workspaceUrl: string): string {
  return join(cacheDir(), workspaceKey(workspaceUrl), "users.json");
}

async function load(workspaceUrl: string): Promise<UserCache> {
  try {
    const parsed = JSON.parse(await readFile(pathFor(workspaceUrl), "utf8"));
    if (parsed?.version === 2 && parsed?.users && parsed?.identities) return parsed;
    if (parsed?.version === 1 && parsed?.users) {
      return { version: 2, workspace: parsed.workspace || workspaceUrl, updatedAt: parsed.updatedAt || "", users: parsed.users, identities: {} };
    }
  } catch { /* Cache miss. */ }
  return { version: 2, workspace: workspaceUrl, updatedAt: "", users: {}, identities: {} };
}

async function save(workspaceUrl: string, cache: UserCache): Promise<void> {
  const path = pathFor(workspaceUrl);
  await mkdir(join(cacheDir(), workspaceKey(workspaceUrl)), { recursive: true, mode: 0o700 });
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(temp, `${JSON.stringify(cache, null, 2)}\n`, { mode: 0o600 });
    await chmod(temp, 0o600).catch(() => {});
    await rename(temp, path);
  } finally {
    await rm(temp, { force: true }).catch(() => {});
  }
}

async function mapConcurrent<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]!);
  }));
}

export async function resolveCachedUsers(
  workspaceUrl: string,
  ids: string[],
  lookup: (id: string) => Promise<string | undefined>,
): Promise<Record<string, string>> {
  const cache = await load(workspaceUrl);
  const unique = [...new Set(ids.filter(Boolean))];
  const missing = unique.filter(id => !cache.users[id]);
  await mapConcurrent(missing, 6, async id => {
    const name = await lookup(id).catch(() => undefined);
    if (name) cache.users[id] = name;
  });
  if (missing.length) {
    cache.updatedAt = new Date().toISOString();
    await save(workspaceUrl, cache);
  }
  return Object.fromEntries(unique.map(id => [id, cache.users[id] || id]));
}

export async function refreshUserCache(
  workspaceUrl: string,
  list: (cursor?: string) => Promise<{ users?: any[]; response_metadata?: { next_cursor?: string } }>,
): Promise<number> {
  const users: Record<string, string> = {};
  let cursor: string | undefined;
  do {
    const page = await list(cursor);
    for (const user of page.users || []) {
      const name = user.profile?.display_name || user.profile?.real_name || user.real_name || user.name;
      if (user.id && name) users[user.id] = name;
    }
    cursor = page.response_metadata?.next_cursor || undefined;
  } while (cursor);
  const existing = await load(workspaceUrl);
  await save(workspaceUrl, { ...existing, version: 2, workspace: workspaceUrl, updatedAt: new Date().toISOString(), users });
  return Object.keys(users).length;
}

export async function resolveCachedIdentity(
  workspaceUrl: string,
  userId: string,
  lookup: () => Promise<Omit<Identity, "fetchedAt"> | undefined>,
  maxAgeMs = 7 * 24 * 60 * 60 * 1000,
): Promise<Identity | undefined> {
  const cache = await load(workspaceUrl);
  const existing = cache.identities[userId];
  if (existing && Date.now() - Date.parse(existing.fetchedAt) < maxAgeMs) return existing;
  const fresh = await lookup().catch(() => undefined);
  if (!fresh) return existing;
  const identity = { ...fresh, fetchedAt: new Date().toISOString() };
  cache.identities[userId] = identity;
  if (identity.displayName) cache.users[userId] = identity.displayName;
  cache.updatedAt = identity.fetchedAt;
  await save(workspaceUrl, cache);
  return identity;
}
