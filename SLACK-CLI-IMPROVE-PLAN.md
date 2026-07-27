# Slack CLI Improvement Plan

## Overview

Improvements to make the CLI more useful for AI agents reading and interacting with Slack.

## Foundation: persistent user-name cache

**Files:** `src/client.ts`, new `src/user-cache.ts`, `index.ts`

**Problem:** User resolution currently calls `users.info` for every distinct author on every command. This is slow, can exceed Slack rate limits, and only changes author fields; Slack mention markup in message text (for example `<@U123>`) still exposes raw IDs.

**Fix:** Add a workspace-scoped, persistent cache of Slack user IDs to display names.

1. At CLI startup, load `$XDG_CACHE_HOME/slack-cli/<workspace-id>/users.json` (falling back to `~/.cache/slack-cli/...` when `XDG_CACHE_HOME` is absent). Do not put this cache or browser tokens in the repository.
2. `resolveUsers` should serve cached names first, fetch only unknown IDs with a bounded-concurrency `users.info` queue, then atomically write the updated cache. Preserve the raw ID as the fallback when Slack cannot resolve an account (for example a deleted user or bot).
3. Add `slack-cli cache users --refresh`, which uses paginated `users.list` to rebuild the cache. Add a global `--refresh-users` flag to force that same refresh before a normal command. A 24-hour TTL can automatically refresh stale entries, but explicit refresh must always be available because names can change sooner.
4. Add a shared text renderer that replaces `<@USER_ID>` with `@Display Name`; use it in `unread`, `search`, and `context`, including thread replies. Resolve bot IDs separately where Slack exposes a bot profile.
5. Cache only non-sensitive identity data (workspace identifier, names, timestamps, and schema version). Browser tokens live in the credential store described below; they are credentials, not cache data.

**Why it matters:** Every command will consistently show people rather than IDs, without an API request per author on every run. A person or agent can refresh the cache immediately when a name appears stale.

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

1. Call `auth.test` once at startup to get the current user's ID (e.g. `U07J2JP4BME`). Keep it in the process cache so it is available without repeated round-trips. The user-name cache above is independent and persistent.
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

## 6. Production authentication and configuration

**Files:** new `src/config.ts`, `src/client.ts`, `src/commands/auth.ts`, `index.ts`, `.env.example`, `README.md`

**Problem:** The current executable reads and writes a repository-relative `.env` through `import.meta.dir`. That works during Bun development but makes a compiled release dependent on source-layout assumptions and gives each working directory a different implicit credential location.

**Fix:** Make a per-user operating-system configuration directory the normal credential store. `.env` remains an optional development/automation override, never a required runtime dependency.

1. Add `src/config.ts` to resolve production paths without using `import.meta.dir`:
   - Linux: `$XDG_CONFIG_HOME/slack-cli/credentials.json`, falling back to `~/.config/slack-cli/credentials.json`.
   - macOS: `~/Library/Application Support/slack-cli/credentials.json`.
   - Windows: `%APPDATA%\slack-cli\credentials.json`.
   - User-name cache stays separately in the OS cache directory, not beside credentials.
2. Store versioned, profile-scoped credentials: `workspaceUrl`, `xoxc`, `xoxd`, and `updatedAt`. Support an `activeProfile`, `--profile <name>` for a command, and `auth --profile <name>` when saving credentials.
3. `slack-cli auth` must parse the pasted cURL, decode xoxd, test `auth.test`, and atomically write the production credential store with owner-only permissions where supported. Do not write `.env`.
4. Resolve credentials in this order: explicit `--profile` / active stored profile, then `SLACK_XOXC_TOKEN`, `SLACK_XOXD_TOKEN`, and `SLACK_WORKSPACE_URL` environment-variable overrides. The environment path supports agents and CI; the stored profile supports normal end users. `.env` loading is development-only behavior provided by Bun, not an application requirement.
5. Add `slack-cli auth status`, `slack-cli logout [--profile <name>]`, and `slack-cli config path`. Never print complete tokens; status should report the selected profile, workspace, and whether `auth.test` succeeds.
6. Make cURL extraction accept common quoting and cookie forms (single or double quotes, `-b`/`--cookie`, and cookie headers), and give actionable errors for missing values. Normalize a URL-encoded xoxd value at the client boundary too, with a safe fallback for malformed percent escapes.
7. Keep only `SLACK_XOXC_TOKEN`, `SLACK_XOXD_TOKEN`, and optional `SLACK_WORKSPACE_URL` in `.env.example` for development overrides. `SLACK_USER_TOKEN` (`xoxp`) is unused and must not appear in examples or documentation.

## 7. Reliability and output correctness

**Files:** `src/commands/unread.ts`, `src/expand.ts`, `src/commands/context.ts`, `src/commands/search.ts`

1. Paginate `conversations.history`, `conversations.replies`, and `users.list`, or surface an explicit truncation indicator. Current limits of 200 history messages and 100 replies can silently omit unread content.
2. Limit concurrent Slack API requests. The existing unbounded `Promise.all` across conversations, threads, and users risks rate limiting.
3. For `--threads`, fetch the full parent thread when a matching reply is found. This is required for `--mentions --threads` to show the parent and all replies rather than an isolated match.
4. Sort surrounding context and thread messages chronologically. Slack history commonly returns reverse chronological order.
5. Render the matched message in `context`. The current text renderer excludes it from `surrounding`, so its marker can never appear.
6. Avoid expansion API calls for `search --window=0` unless thread output is explicitly requested.
7. Validate `--after` and `--before` as `YYYY-MM-DD` before appending Slack search modifiers.

## 8. Test coverage

Add mocked Slack API tests for user-cache hit/miss/refresh behavior, production config path selection, profile selection, environment overrides, atomic credential writes, encoded and raw xoxd values, pagination, bounded concurrency, mention matches in thread replies, attachment output, date-flag validation, and context match ordering. Tests should verify both text and JSON output where their schemas differ.

## 9. Advanced direct Slack API access

**Files:** new `src/commands/api.ts`, `src/client.ts`, `index.ts`, `README.md`

**Problem:** Agents occasionally need a Slack API method that does not yet have a dedicated CLI command. Requiring them to find and reproduce browser tokens in ad-hoc cURL commands is unsafe, hard to audit, and bypasses the CLI's profile, credential, retry, and output behavior.

**Fix:** Provide a safe, JSON-first API escape hatch using the CLI's authenticated client:

```sh
slack-cli api auth.test --json
slack-cli api users.info --params '{"user":"U123"}' --json
slack-cli api conversations.history --params '{"channel":"C123","limit":100}' --json
slack-cli api conversations.replies --params '{"channel":"C123","ts":"1710000000.000001"}' --json
```

1. Implement `slack-cli api <method> --params <json> --json`. `--params` must be a single JSON object and raw JSON must be the default output, preserving Slack's response fields for agents. Return API failures as structured JSON containing the method and Slack error code.
2. Start with a read-only allowlist covering `auth.test`, `users.info`, `users.list`, `conversations.info`, `conversations.list`, `conversations.history`, `conversations.replies`, `conversations.members`, `search.messages`, `client.counts`, and `users.prefs.get`.
3. Reject methods outside the allowlist unless `--unsafe-method` is present. Any mutation additionally requires `--allow-write --yes`; keep purpose-built commands such as `mark` for common write operations. Validate method names before dispatching and never log request credentials.
4. Reuse the selected profile, credential resolution, retry/rate-limit handling, and redaction rules from `client.ts`. Do not require users or agents to provide tokens on the command line.
5. Add `slack-cli api methods` and `slack-cli api describe <method>`. The built-in catalog should identify read/write behavior, key parameters, pagination, and copyable examples for supported methods.
6. Add an **Advanced: direct Slack API calls** README section that explains this is an escape hatch, that responses are raw and can include IDs, and that browser credentials may not support every public Slack API method. Link agents to the official [Slack Web API method reference](https://api.slack.com/methods) for complete, current method semantics and parameters.
7. Direct API write smoke verified on the explicitly authorized DM `D07HSEYFB5X`: `chat.postMessage` created a temporary message and `chat.delete` removed it successfully (`ts` `1785169565.933569`). When implementing the escape hatch, this is a manual verification pattern, not a requirement for an automated write-test harness: use `chat.postMessage` with a clearly labeled temporary message, retain the returned `ts`, then call `chat.delete` with the same `channel` and `ts`. Perform it only with explicit approval for the target DM; report the exact methods and parameters used. Do not post, edit, delete, or otherwise create message content in other conversations without fresh, operation-specific authorization.

## Implementation Order

| Priority | Change | Effort | Impact |
|---|---|---|---|
| 1 | Persistent user-name cache + shared mention rendering | Medium | High — readable output and fewer API calls everywhere |
| 2 | Production credential store and profile support | Medium | High — released binaries work independently of project layout |
| 3 | Pagination, concurrency limits, context-limit fix | Medium | High — prevents silent omissions and rate-limit failures |
| 4 | `--threads` content fetching + `--mentions` | Medium | High — thread replies are visible and actionable |
| 5 | `--files` flag | Low | Medium — agents can see attachments |
| 6 | `--after` / `--before` on search | Low | Medium — enables time-scoped searches |
| 7 | Direct API escape hatch + method catalog | Medium | High — agents can use unwrapped read methods safely |
| 8 | Mocked API/output tests | Medium | High — protects behavior as browser APIs evolve |

---

## Key Files

```
index.ts                    — CLI entry, flag parsing, command dispatch
src/client.ts               — API client, auth, user resolution
src/config.ts               — OS-specific credential paths and profile management
src/user-cache.ts           — persistent workspace user-name cache
src/expand.ts               — shared context expansion (threads + history)
src/commands/unread.ts      — unread command
src/commands/search.ts      — search command
src/commands/context.ts     — context command
src/commands/mark.ts        — mark-as-read command
src/commands/auth.ts        — token extraction from curl command
src/commands/api.ts         — guarded raw Slack API escape hatch
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
- `users.list` — refresh the persistent user-name cache
- `auth.test` — get current user ID (needed for `--mentions`)
