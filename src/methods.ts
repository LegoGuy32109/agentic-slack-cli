// One catalogue of Slack methods, shared by the `api` escape hatch and by the
// typed commands. Before this existed, send.ts and api.ts each knew about
// chat.postMessage independently, so adding a method meant teaching two places.
//
// `effect` classifies what a call leaves behind, which is a stronger statement
// than "is it a write". A message can be deleted. A file outlives the message it
// was posted with, stays fetchable by permalink, and counts against workspace
// storage, so it is gated the same way but previewed far more loudly.

export type Effect = "read" | "message" | "file" | "list-mutation";

export type MethodInfo = {
  effect: Effect;
  description: string;
  example: Record<string, unknown>;
  required?: string[];
};

export const methods: Record<string, MethodInfo> = {
  "auth.test": { effect: "read", description: "Identify the authenticated Slack user and workspace.", example: {} },
  "users.info": { effect: "read", description: "Get one user's profile.", example: { user: "U123" }, required: ["user"] },
  "users.list": { effect: "read", description: "List workspace users; paginate with cursor.", example: { limit: 200 } },
  "conversations.info": { effect: "read", description: "Get channel or DM metadata.", example: { channel: "C123" }, required: ["channel"] },
  "conversations.list": { effect: "read", description: "List conversations; paginate with cursor.", example: { limit: 200 } },
  "conversations.history": { effect: "read", description: "Get channel messages; paginate with cursor.", example: { channel: "C123", limit: 100 }, required: ["channel"] },
  "conversations.replies": { effect: "read", description: "Get a message thread; paginate with cursor.", example: { channel: "C123", ts: "1710000000.000001", limit: 100 }, required: ["channel", "ts"] },
  "conversations.members": { effect: "read", description: "List conversation members; paginate with cursor.", example: { channel: "C123", limit: 200 }, required: ["channel"] },
  "search.messages": { effect: "read", description: "Search workspace messages.", example: { query: "deployment after:2026-01-01", count: 20 }, required: ["query"] },
  "client.counts": { effect: "read", description: "Get browser-client unread counts.", example: {} },
  "users.prefs.get": { effect: "read", description: "Get user preferences including muted channels.", example: {} },
  "chat.getPermalink": { effect: "read", description: "Get a permanent link to one message.", example: { channel: "C123", message_ts: "1710000000.000001" }, required: ["channel", "message_ts"] },
  "files.info": { effect: "read", description: "Get one file's metadata, including where it was shared.", example: { file: "F123" }, required: ["file"] },
  "conversations.mark": { effect: "message", description: "Mark a conversation read through a timestamp.", example: { channel: "C123", ts: "1710000000.000001" }, required: ["channel", "ts"] },
  "chat.postMessage": { effect: "message", description: "Post a message to a conversation. Native blocks arrays are JSON-encoded for Slack.", example: { channel: "C123", text: "Hello", blocks: [{ type: "section", text: { type: "mrkdwn", text: "Hello" } }] }, required: ["channel"] },
  "chat.update": { effect: "message", description: "Edit a message's text or blocks in place. Only the authenticated user's own messages; Slack returns cant_update_message otherwise.", example: { channel: "C123", ts: "1710000000.000001", text: "Hello, edited" }, required: ["channel", "ts"] },
  "chat.delete": { effect: "message", description: "Delete a message authored by the authenticated user.", example: { channel: "C123", ts: "1710000000.000001" }, required: ["channel", "ts"] },
  "reactions.add": { effect: "message", description: "Add an emoji reaction to a message.", example: { channel: "C123", timestamp: "1710000000.000001", name: "white_check_mark" }, required: ["channel", "timestamp", "name"] },
  "files.getUploadURLExternal": { effect: "file", description: "Reserve an upload URL and file id. Creates a file object before any bytes exist, so a failed upload leaves an orphan.", example: { filename: "report.md", length: 1024 }, required: ["filename", "length"] },
  "files.completeUploadExternal": { effect: "file", description: "Finish an upload and optionally share it to a channel with an initial comment.", example: { files: [{ id: "F123", title: "report.md" }], channel_id: "C123", initial_comment: "here it is" }, required: ["files"] },
  "files.delete": { effect: "file", description: "Delete a file the authenticated user owns. The undo for a mis-sent upload or an orphan.", example: { file: "F123" }, required: ["file"] },
};

export function methodInfo(method: string): MethodInfo | undefined {
  return methods[method];
}

export function isWrite(info: MethodInfo | undefined): boolean {
  return !!info && info.effect !== "read";
}

export function missingRequired(info: MethodInfo | undefined, params: Record<string, unknown>): string[] {
  if (!info?.required) return [];
  return info.required.filter(name => params[name] === undefined || params[name] === null || params[name] === "");
}

export function catalogEntries() {
  return Object.entries(methods).map(([method, info]) => ({
    method,
    mode: isWrite(info) ? "write" : "read",
    effect: info.effect,
    description: info.description,
  }));
}
