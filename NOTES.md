# Development Notes

`NOTES.md` is a living development artifact. Keep it current as behavior,
architecture, release practices, constraints, and known limitations change.
Record durable decisions and unresolved risks that a future contributor needs;
do not use it for user-specific workflows, credentials, local snapshots, or
temporary task logs. Remove or revise entries once they are no longer true.

## Current release

- `v1.0.1` is published with Linux, macOS ARM/x64, and Windows binaries.
- A release is created by pushing an annotated `v*` tag; `.github/workflows/release.yml` builds assets and publishes the GitHub Release.

## CLI behavior implemented

- Browser credentials are stored in a per-user OS config directory with profiles; environment variables remain automation overrides.
- Workspace user and channel references are cached. `users find` resolves user
  IDs, names, and handles; channel-taking commands accept IDs, names, or `#name`.
- `unread` supports `--threads`, `--files`, and `--mentions`; it renders cached user names and Slack mention markup.
- `search` supports `--after` and `--before`; `api` provides guarded, JSON-first direct Slack API access.
- JSON message results include canonical `content`, which incorporates visible
  rich-text and attachment-backed prompt content. `search` defaults to no
  surrounding window; use `context` for selected message IDs.
- The workspace user cache stores authenticated identity metadata, including an
  IANA timezone used for exact local-day search filtering.
- `history` and `send` provide top-level conversation polling and posting.
- `send`, `mark`, and direct API writes preview by default. `--allow-write` is
  the sole flag that performs a Slack mutation.
- Direct API parameters accept inline JSON or `@file`; structured values are
  JSON-encoded for Slack's form transport. Outbound `@{Name}` tokens resolve to
  Slack mentions only when they identify exactly one cached user.
- File `permalink` values open Slack's file page. `url_private` is the actual private asset URL and should be fetched through an authenticated backend proxy for a web UI.

## Thread unread limitation

Slack has two distinct unread models:

1. Channel unread top-level messages, based on a conversation read cursor.
2. Unread replies in followed or mentioned threads, surfaced by Slack's Threads view.

The current `unread --threads` implementation expands full threads beneath unread parents for context. It does **not** distinguish individually unread replies from contextual replies. `conversations.mark` is safe for top-level chronological messages, but can hide later thread replies when their parent falls before the mark timestamp.

Do not use partial chronological marks as a guarantee that all later thread replies remain in Slack's unread view. A robust future implementation needs to merge the channel unread feed with Slack's unread-thread-reply feed and label replies as unread versus context-only.
