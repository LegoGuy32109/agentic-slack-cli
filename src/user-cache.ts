import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { cacheDir } from "./config.ts";

type Identity = {
  username?: string;
  displayName?: string;
  timezone?: string;
  fetchedAt: string;
};

export type CachedUser = Identity & { id: string; realName?: string; active?: boolean };

type UserCache = {
  version: 3;
  workspace: string;
  updatedAt: string;
  users: Record<string, CachedUser>;
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
    if (parsed?.version === 3 && parsed?.users) return parsed;
    if (parsed?.version === 2 && parsed?.users) {
      const users: Record<string, CachedUser> = Object.fromEntries(Object.entries(parsed.users as Record<string, string>).map(([id, displayName]) => [id, { id, displayName, fetchedAt: parsed.updatedAt || "" }]));
      for (const [id, identity] of Object.entries(parsed.identities || {})) users[id] = { id, ...(identity as Identity) };
      return { version: 3, workspace: parsed.workspace || workspaceUrl, updatedAt: parsed.updatedAt || "", users };
    }
    if (parsed?.version === 1 && parsed?.users) {
      return { version: 3, workspace: parsed.workspace || workspaceUrl, updatedAt: parsed.updatedAt || "", users: Object.fromEntries(Object.entries(parsed.users as Record<string, string>).map(([id, displayName]) => [id, { id, displayName, fetchedAt: parsed.updatedAt || "" }])) };
    }
  } catch { /* Cache miss. */ }
  return { version: 3, workspace: workspaceUrl, updatedAt: "", users: {} };
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
  const missing = unique.filter(id => !cache.users[id]?.displayName);
  await mapConcurrent(missing, 6, async id => {
    const name = await lookup(id).catch(() => undefined);
    if (name) cache.users[id] = { id, displayName: name, fetchedAt: new Date().toISOString() };
  });
  if (missing.length) {
    cache.updatedAt = new Date().toISOString();
    await save(workspaceUrl, cache);
  }
  return Object.fromEntries(unique.map(id => [id, cache.users[id]?.displayName || id]));
}

export async function refreshUserCache(
  workspaceUrl: string,
  list: (cursor?: string) => Promise<{ users?: any[]; response_metadata?: { next_cursor?: string } }>,
): Promise<number> {
  const users: Record<string, CachedUser> = {};
  let cursor: string | undefined;
  do {
    const page = await list(cursor);
    for (const user of page.users || []) {
      if (user.id) users[user.id] = { id: user.id, username: user.name, displayName: user.profile?.display_name || user.profile?.real_name || user.real_name || user.name, realName: user.profile?.real_name || user.real_name, active: !user.deleted, timezone: user.tz, fetchedAt: new Date().toISOString() };
    }
    cursor = page.response_metadata?.next_cursor || undefined;
  } while (cursor);
  const existing = await load(workspaceUrl);
  await save(workspaceUrl, { ...existing, version: 3, workspace: workspaceUrl, updatedAt: new Date().toISOString(), users });
  return Object.keys(users).length;
}

export async function resolveCachedIdentity(
  workspaceUrl: string,
  userId: string,
  lookup: () => Promise<Omit<Identity, "fetchedAt"> | undefined>,
  maxAgeMs = 7 * 24 * 60 * 60 * 1000,
): Promise<Identity | undefined> {
  const cache = await load(workspaceUrl);
  const existing = cache.users[userId];
  if (existing && Date.now() - Date.parse(existing.fetchedAt) < maxAgeMs) return existing;
  const fresh = await lookup().catch(() => undefined);
  if (!fresh) return existing;
  const identity = { ...fresh, fetchedAt: new Date().toISOString() };
  cache.users[userId] = { id: userId, ...identity };
  cache.updatedAt = identity.fetchedAt;
  await save(workspaceUrl, cache);
  return identity;
}

export async function findCachedUsers(workspaceUrl: string, query: string): Promise<CachedUser[]> {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [];
  const cache = await load(workspaceUrl);
  const score = (user: CachedUser) => {
    const values = [user.displayName, user.realName, user.username].filter((value): value is string => !!value).map(value => value.toLowerCase());
    return values.some(value => value === normalized) ? 0 : values.some(value => value.startsWith(normalized)) ? 1 : values.some(value => value.includes(normalized)) ? 2 : 3;
  };
  return Object.values(cache.users).filter(user => score(user) < 3).sort((a, b) => score(a) - score(b) || (a.displayName || a.username || a.id).localeCompare(b.displayName || b.username || b.id));
}
