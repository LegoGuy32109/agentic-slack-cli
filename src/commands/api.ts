import { call } from "../client.ts";

type MethodInfo = { write?: boolean; description: string; example: Record<string, unknown> };

const methods: Record<string, MethodInfo> = {
  "auth.test": { description: "Identify the authenticated Slack user and workspace.", example: {} },
  "users.info": { description: "Get one user's profile.", example: { user: "U123" } },
  "users.list": { description: "List workspace users; paginate with cursor.", example: { limit: 200 } },
  "conversations.info": { description: "Get channel or DM metadata.", example: { channel: "C123" } },
  "conversations.list": { description: "List conversations; paginate with cursor.", example: { limit: 200 } },
  "conversations.history": { description: "Get channel messages; paginate with cursor.", example: { channel: "C123", limit: 100 } },
  "conversations.replies": { description: "Get a message thread; paginate with cursor.", example: { channel: "C123", ts: "1710000000.000001", limit: 100 } },
  "conversations.members": { description: "List conversation members; paginate with cursor.", example: { channel: "C123", limit: 200 } },
  "search.messages": { description: "Search workspace messages.", example: { query: "deployment after:2026-01-01", count: 20 } },
  "client.counts": { description: "Get browser-client unread counts.", example: {} },
  "users.prefs.get": { description: "Get user preferences including muted channels.", example: {} },
  "conversations.mark": { write: true, description: "Mark a conversation read through a timestamp.", example: { channel: "C123", ts: "1710000000.000001" } },
  "chat.postMessage": { write: true, description: "Post a message to a conversation.", example: { channel: "C123", text: "Hello" } },
  "chat.delete": { write: true, description: "Delete a message authored by the authenticated user.", example: { channel: "C123", ts: "1710000000.000001" } },
  "reactions.add": { write: true, description: "Add an emoji reaction to a message.", example: { channel: "C123", timestamp: "1710000000.000001", name: "white_check_mark" } },
};

export function apiMethods() {
  return Object.entries(methods).map(([method, info]) => ({ method, mode: info.write ? "write" : "read", description: info.description }));
}

export function apiDescribe(method: string) {
  const info = methods[method];
  return info ? { method, mode: info.write ? "write" : "read", description: info.description, example: info.example } : undefined;
}

export async function api(method: string, paramsText: string | undefined, opts: { unsafe: boolean; allowWrite: boolean; yes: boolean }) {
  if (!/^[a-z]+(?:\.[a-zA-Z]+)+$/.test(method)) throw new Error("Invalid Slack API method name.");
  let params: Record<string, unknown> = {};
  if (paramsText) {
    try { params = JSON.parse(paramsText); } catch { throw new Error("--params must be a valid JSON object."); }
    if (!params || Array.isArray(params) || typeof params !== "object") throw new Error("--params must be a JSON object.");
  }
  const info = methods[method];
  if (!info && !opts.unsafe) throw new Error(`Method ${method} is not in the read-only catalog. Use --unsafe-method after checking the Slack API reference.`);
  if ((info?.write || !info) && (!opts.allowWrite || !opts.yes)) {
    throw new Error("Write or unknown methods require both --allow-write and --yes.");
  }
  return call(method, params);
}
