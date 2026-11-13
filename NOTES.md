# Development Notes

`NOTES.md` is a living development artifact. Keep it current as behavior,
architecture, release practices, constraints, and known limitations change.
Record durable decisions and unresolved risks that a future contributor needs;
do not use it for user-specific workflows, credentials, local snapshots, or
temporary task logs. Remove or revise entries once they are no longer true.

## Release distribution

- Public releases include Linux, macOS ARM/x64, and Windows binaries. The latest GitHub release identifies the current version.
- A release is created by pushing an annotated `v*` tag; `.github/workflows/release.yml` builds assets and publishes the GitHub Release.

## CLI behavior implemented

- Browser credentials are stored in a per-user OS config directory with profiles; environment variables remain automation overrides.
- Workspace user and channel references are cached. `users find` resolves user
  IDs, names, and handles; channel-taking commands accept IDs, names, or `#name`.
- `unread` shows everything by default (channels, groups, DMs, followed threads, files as links), excludes muted conversations unless `--all`, and renders cached user names and Slack mention markup. `search` is the path to filter by mention, `@handle`/`@{Name}`/`<@ID>` in the query, for any user, not just the caller.
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

## Two unread models, both covered

Slack has two distinct unread surfaces, and they need two different writes:

1. Channel-level unread top-level messages, based on a conversation read cursor
   (`client.counts`, cleared by `conversations.mark`).
2. Unread replies in followed or mentioned threads, Slack's own Threads view
   (`subscriptions.thread.getView`, cleared by `subscriptions.thread.mark`).
   `conversations.mark` does not touch this surface at all, confirmed live,
   marking a channel read leaves its followed threads' unread state untouched.

`unread` scans and merges both (`src/unread-scan.ts`), tagging each message with
`source: "channel" | "thread"`. `mark <ts>` re-scans both at call time and writes
to whichever endpoint applies, per conversation or thread, continuing past
individual failures.

`mark` never reads a conversation's current cursor before writing, so it does not
guard against moving a cursor backward if the read cursor already advanced past
`ts` some other way (reading natively in Slack in the meantime). That's an
accepted, rare cost. What it does guarantee: no write it makes can move a cursor
past `ts` itself, so anything timestamped after `ts`, regardless of whether that
conversation was ever shown to the caller, keeps its own later timestamp and
stays unread. `mark` deliberately does not require the caller's exact
conversation list for this reason, a fresh scan is exactly as safe as a stored
one, since the timestamp boundary is what actually protects unseen content.
