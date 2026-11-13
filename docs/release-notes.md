# v2.0.0 release notes

This release combines the current Slack CLI features with the existing GitHub installer and checksum-verified updater.
Existing users can install it with `slack-cli update`.

## Added

- Edit your own messages with `edit`, including rich lists and raw Block Kit.
- Attach multiple files with `send --file`, optional titles, and thread placement.
- Inspect file paths, sizes, hashes, and text previews before uploading.
- Check posted file IDs and sizes with `--verify`.
- Reply in a thread with `send --thread-ts`.
- Receive message timestamps and permalinks in send and edit receipts.
- Warn when a plain `@Name` will not notify anyone.
- Inspect required API parameters and operation effects through the shared method catalog.
- Install on Windows with a checksum-verified PowerShell installer, without administrator access.
- Use structured demo examples, annotated sign-in instructions, and copyable agent prompts.

## Changed: read marking and unread scans

`mark` now requires the timestamp boundary printed by `unread`.
The old `mark <channel> [timestamp]` syntax is removed.

```sh
slack-cli unread --json
# Substitute request_ts from that result:
slack-cli mark 1710000000.000001 --only general
```

Review the preview before adding `--allow-write`.
`--only` restricts destinations. `--ignore` excludes them. Both accept comma-separated names or IDs and cannot combine.
The scan at marking time includes unread conversations and followed threads. No cursor advances past the supplied timestamp.

`unread` now includes thread replies and file links by default.
The old `--threads`, `--files`, and `--mentions` switches are removed. JSON includes a `mentioned` marker on matching messages.
`--all` still includes muted conversations.

`unread --json` now returns `{request_ts, conversations: [...]}` instead of a top-level array.
Each message uses `source: "channel" | "thread"` in place of the old `thread` boolean.
Update scripts that parse unread results before upgrading.

`send --json` now returns a concise receipt with `effect`, `channel`, `ts`, `permalink`, and `files` instead of the raw Slack response.
File receipts may omit `ts` until share metadata becomes available. Use `--verify` when readback is needed.

## Installation and updates

The installer, updater, release asset names, and credential locations remain compatible with existing installations.
All three binary targets and `SHA256SUMS` must be published together.
Intel macOS binaries are no longer supplied. Intel Mac users can build from source.
The major version reflects the command and JSON changes above.

## Validation

Linux typecheck, all 60 automated tests, the compiled build, and offline command previews pass.
Updater tests cover read-only checks, checksum rejection, missing assets, and replacement of a disposable executable.
Windows installer fixtures pass in PowerShell 5.1 and 7, including user PATH preservation and repeated installation.
Windows delayed executable replacement and macOS execution have not been smoke-tested.
Demo messages and the file attachment were posted in the approved demo workspace and confirmed through API readback.
Four user-supplied Slack screenshots were visually reviewed and added to the README.
