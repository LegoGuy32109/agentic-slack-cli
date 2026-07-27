# Slack CLI Improvement Plan

## Overview

Five improvements to make the CLI more useful for AI agents reading and interacting with Slack. All changes are additive flags — existing behavior is unchanged by default.

---

## 1. Fix `--threads` on `unread`

**File:** `src/commands/unread.ts`

**Problem:** `--threads` currently sets `thread: true` as a boolean marker on messages that have replies. It does not fetch or include the actual reply content.

**Fix:** For every message where `reply_count > 0`, call `conversations.replies` and inline the reply messages into the output — matching the pattern already used in `src/expand.ts`. Batch the calls with `Promise.all` to keep it fast.

**Current output:**
```
[12:00 PM] Seth Foss: PR review
  thread: true
```

**Expected output:**
```
[12:00 PM] Seth Foss: PR review
  ↳ [12:05 PM] Josh Hale: approved
  ↳ [12:08 PM] Seth Foss: we may need to have this convo on Monday when @Josh Hale is back
```

**Why it matters for agents:** Critical messages often live in thread replies. During this session, a scheduled Monday meeting (`"we may need to have this convo on Monday when @Josh Hale is back from vacation"`) was only in a thread reply and was completely invisible to `unread` without this fix.

---

## 2. `--files` flag on `unread`

**File:** `src/commands/unread.ts`

**Problem:** The raw Slack API returns `files[]` on messages with attachments, but `unread.ts` discards them. Agents cannot tell when a message contains an image, PDF, or other file.

**Fix:** Add a `--files` boolean flag. When set, extract file metadata from each message's `files[]` array and include it in output. Use the same structure already implemented in `src/expand.ts`:

```typescript
type ExpandedFile = {
  name: string;
  filetype: string;
  url_private: string;  // auth-gated download URL
  permalink: string;    // Slack permalink
};
```

Text output format (same as context/search already does):
```
[1:08 PM] Dylan Vester: 
  [file: image.png (png) https://gogeoh.slack.com/files/...]
```

JSON output: include `files: ExpandedFile[]` on each message object.

**Why it matters for agents:** Without this, a message with no `text` and only an image appears completely empty. During this session, Dylan's MakerWorld income graph and a PowerPoint presentation were invisible until a custom raw API script was written.

---

## 3. `--mentions` flag on `unread`

**Files:** `src/commands/unread.ts`, `src/client.ts`

**Problem:** `unread` returns everything — in a busy channel like `#engineering` this is 274 messages. Agents and users are overwhelmed. The most actionable messages are ones where you're directly addressed.

**Fix:** Add a `--mentions` boolean flag. When set:

1. Call `auth.test` once at startup to get the current user's ID (e.g. `U07J2JP4BME`). Cache this in `client.ts` so it's available without an extra round-trip.
2. After fetching all unread messages (and thread replies if `--threads` is also set), filter to only messages whose `text` contains:
   - `<@CURRENT_USER_ID>` — direct mention
   - `<!here>` — @here
   - `<!channel>` — @channel

**Text output:** prefix matched messages with `@` marker instead of a space:
```
@ [2:00 PM] Seth Foss: we may need to have this convo on Monday when @Josh Hale is back
```

**JSON output:** add `"mentioned": true` field on matched messages.

**Important:** `--mentions` should respect `--threads` — if a thread reply mentions you, include the whole thread (parent + replies), not just the reply in isolation.

**Why it matters for agents:** Reduces signal-to-noise drastically. The Monday meeting notice was a thread reply with a direct `@Josh Hale` mention — `--mentions --threads` together would have found it in one command.

---

## 4. Fix Context Window Message Limit

**File:** `src/expand.ts`

**Problem:** The `conversations.history` call uses `limit: Math.min(window * 4 + 1, 200)`. With `--window=1` this caps at **5 messages**, causing silent truncation. Agents get partial context and have no way to know messages were cut off.

**Current code:**
```typescript
limit: Math.min(window * 4 + 1, 200),
```

**Fix:** Remove the dependency on window size. Always request the API maximum and let the `oldest`/`latest` time bounds do the filtering:
```typescript
limit: 200,
```

The time window already controls how much history comes back. The message limit was an unnecessary and harmful second constraint that silently truncated results.

**Why it matters for agents:** During this session, `context --window=1` repeatedly returned only 5 messages when the surrounding conversation had 20+. Had to fall back to raw `conversations.history` calls to get complete context.

---

## 5. `--after` and `--before` Date Flags on `search`

**File:** `src/commands/search.ts`, `index.ts`

**Problem:** Slack's search API supports `after:YYYY-MM-DD` and `before:YYYY-MM-DD` modifiers natively, but they're not surfaced as first-class flags. Users and agents have to know to embed them in the query string manually.

**Fix:** Add `--after=YYYY-MM-DD` and `--before=YYYY-MM-DD` flags. When provided, append the modifiers to the query before passing to the API:

```typescript
// index.ts
const after = flagArgs.find(a => a.startsWith('--after='))?.split('=')[1];
const before = flagArgs.find(a => a.startsWith('--before='))?.split('=')[1];

// search.ts
let fullQuery = query;
if (opts.after) fullQuery += ` after:${opts.after}`;
if (opts.before) fullQuery += ` before:${opts.before}`;
```

**Usage:**
```sh
slack-cli search "anytime checkin skilled" --after=2026-07-20
slack-cli search "meeting monday" --after=2026-07-24 --before=2026-07-28
```

**Why it matters for agents:** "Find what happened while I was on PTO" or "find the thread from last Thursday" required multiple search attempts with vague queries. Date-bounded search makes these one-shot lookups.

---

## Implementation Order

| Priority | Change | Effort | Impact |
|---|---|---|---|
| 1 | Fix `--threads` content fetching | Medium | High — thread replies are invisible today |
| 2 | Fix context window limit | Trivial | High — silent truncation breaks agent reasoning |
| 3 | `--mentions` flag | Medium | High — primary signal filter for agents |
| 4 | `--files` flag | Low | Medium — agents can't see attachments |
| 5 | `--after` / `--before` on search | Low | Medium — enables time-scoped searches |

---

## Key Files

```
index.ts                    — CLI entry, flag parsing, command dispatch
src/client.ts               — API client, auth, user resolution
src/expand.ts               — shared context expansion (threads + history)
src/commands/unread.ts      — unread command
src/commands/search.ts      — search command
src/commands/context.ts     — context command
src/commands/mark.ts        — mark-as-read command
src/commands/auth.ts        — token extraction from curl command
```

## Slack API Methods Used

- `client.counts` — unread counts + last_read per channel (browser auth only)
- `users.prefs.get` — muted channel list
- `conversations.history` — channel message history
- `conversations.replies` — thread replies
- `conversations.mark` — mark channel as read
- `conversations.list` — resolve channel name to ID
- `conversations.info` — channel metadata
- `search.messages` — full-text search
- `users.info` — resolve user ID to display name
- `auth.test` — get current user ID (needed for `--mentions`)
