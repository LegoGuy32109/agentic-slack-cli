import { loadCredentials } from "./config.ts";
import { refreshUserCache, resolveCachedIdentity, resolveCachedUsers } from "./user-cache.ts";

export type ApiParams = Record<string, unknown>;

let credentialsPromise: ReturnType<typeof loadCredentials> | undefined;
let currentUserPromise: Promise<string> | undefined;
let currentIdentityPromise: Promise<{ id: string; username?: string; displayName?: string; timezone?: string }> | undefined;

async function credentials() {
  credentialsPromise ??= loadCredentials();
  return credentialsPromise;
}

export async function call(method: string, params: ApiParams = {}): Promise<any> {
  const { credentials: auth } = await credentials();
  const body = new URLSearchParams({ token: auth.xoxc });
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) body.set(key, typeof value === "string" ? value : String(value));
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`${auth.workspaceUrl}/api/${method}`, {
      method: "POST",
      headers: {
        "Cookie": `d=${encodeURIComponent(auth.xoxd)}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "Origin": "https://app.slack.com",
        "User-Agent": "Mozilla/5.0 (compatible)",
      },
      body,
    });
    const data = await res.json() as any;
    if (data.ok) return data;
    if ((res.status === 429 || data.error === "ratelimited") && attempt < 2) {
      const seconds = Number(res.headers.get("retry-after") || "1");
      await Bun.sleep(Math.max(1, seconds) * 1000);
      continue;
    }
    throw new Error(`${method} failed: ${data.error}`);
  }
  throw new Error(`${method} failed after retries`);
}

export async function paginate(method: string, params: ApiParams, key: string, maxPages = 20): Promise<any[]> {
  const all: any[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    const result = await call(method, { ...params, ...(cursor ? { cursor } : {}) });
    all.push(...(result[key] || []));
    cursor = result.response_metadata?.next_cursor || undefined;
    if (!cursor) break;
  }
  return all;
}

function userName(user: any): string | undefined {
  return user?.profile?.display_name || user?.profile?.real_name || user?.real_name || user?.name;
}

export async function resolveUsers(ids: string[]): Promise<Record<string, string>> {
  const { credentials: auth } = await credentials();
  return resolveCachedUsers(auth.workspaceUrl, ids, async id => userName((await call("users.info", { user: id })).user));
}

export async function refreshUsers(): Promise<number> {
  const { credentials: auth } = await credentials();
  return refreshUserCache(auth.workspaceUrl, async cursor => {
    const result = await call("users.list", { limit: 200, ...(cursor ? { cursor } : {}) });
    // Browser-auth Slack currently returns `members`; the public API uses `users`.
    return { users: result.users || result.members || [], response_metadata: result.response_metadata };
  });
}

export async function currentUserId(): Promise<string> {
  currentUserPromise ??= call("auth.test").then(result => result.user_id as string);
  return currentUserPromise;
}

export async function currentUserIdentity() {
  currentIdentityPromise ??= (async () => {
    const { credentials: auth } = await credentials();
    const id = await currentUserId();
    const identity = await resolveCachedIdentity(auth.workspaceUrl, id, async () => {
      const user = (await call("users.info", { user: id })).user;
      if (!user) return undefined;
      return {
        username: user.name,
        displayName: userName(user),
        timezone: user.tz,
      };
    });
    return { id, username: identity?.username, displayName: identity?.displayName, timezone: identity?.timezone };
  })();
  return currentIdentityPromise;
}

export async function credentialStatus() {
  const selected = await credentials();
  const identity = await currentUserIdentity();
  return { profile: selected.profile, source: selected.source, workspaceUrl: selected.credentials.workspaceUrl, ...identity };
}

export function renderMentions(text: string, users: Record<string, string>): string {
  return text.replace(/<@([A-Z0-9]+)(?:\|[^>]+)?>/g, (_, id) => `@${users[id] || id}`);
}

export function mentionIds(text: string): string[] {
  return [...text.matchAll(/<@([A-Z0-9]+)(?:\|[^>]+)?>/g)].map(match => match[1]).filter((id): id is string => !!id);
}
