# Project Notes

## Current release

- `v1.0.0` is published with Linux, macOS ARM/x64, and Windows binaries.
- A release is created by pushing an annotated `v*` tag; `.github/workflows/release.yml` builds assets and publishes the GitHub Release.

## CLI behavior implemented

- Browser credentials are stored in a per-user OS config directory with profiles; environment variables remain automation overrides.
- User names are cached by workspace and may be refreshed with `slack-cli cache users --refresh`.
- `unread` supports `--threads`, `--files`, and `--mentions`; it renders cached user names and Slack mention markup.
- `search` supports `--after` and `--before`; `api` provides guarded, JSON-first direct Slack API access.
- JSON message results include canonical `content`, which incorporates visible
  rich-text and attachment-backed prompt content. `search` defaults to no
  surrounding window; use `context` for selected message IDs.
- The workspace user cache stores authenticated identity metadata, including an
  IANA timezone used for exact local-day search filtering.
- `history` and guarded `send` provide top-level conversation polling and
  posting for routine agent workflows; see `JOSH_WORKFLOWS.md`.
- `send`, `mark`, and direct API writes require `--allow-write`.
- File `permalink` values open Slack's file page. `url_private` is the actual private asset URL and should be fetched through an authenticated backend proxy for a web UI.

## Thread unread limitation

Slack has two distinct unread models:

1. Channel unread top-level messages, based on a conversation read cursor.
2. Unread replies in followed or mentioned threads, surfaced by Slack's Threads view.

The current `unread --threads` implementation expands full threads beneath unread parents for context. It does **not** distinguish individually unread replies from contextual replies. `conversations.mark` is safe for top-level chronological messages, but can hide later thread replies when their parent falls before the mark timestamp.

Do not use partial chronological marks as a guarantee that all later thread replies remain in Slack's unread view. A robust future implementation needs to merge the channel unread feed with Slack's unread-thread-reply feed and label replies as unread versus context-only.

## Backlog-review safeguard

- Snapshot saved before review: `~/.cache/slack-cli/review-snapshots/unread-2026-07-27T16-59-40-758Z.json`.
- Review and reporting should continue from that snapshot when checking historical content.
- Before each mark, retain the cutoff timestamp and verify no messages at or before it remain afterward.
- The Jul 27 partial mark exposed the thread limitation: later contextual thread replies disappeared from the CLI unread output. Do not continue partial-day marks until unread thread replies are modeled separately.
