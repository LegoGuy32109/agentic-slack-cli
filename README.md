<h1 align="center">agentic-slack-cli</h1>

<p align="center">
  <strong>Slack, from your terminal.</strong><br>
  For you and your coding agent. Read the context. Preview the message. Send after approval.
</p>

<p align="center">
  <a href="#quick-start">Quick start</a> ·
  <a href="#rich-messages">Rich messages</a> ·
  <a href="#files-and-threads">Files and threads</a> ·
  <a href="#for-coding-agents">For agents</a> ·
  <a href="#updates">Updates</a> ·
  <a href="#command-reference">Commands</a>
</p>

Read a conversation, find the decision, and turn it into a readable update.
The executable is `slack-cli`. Slack writes preview by default. Posting requires `--allow-write`.

<p align="center">
  <img src="docs/images/release-message.png" alt="A Slack release update with build and review status fields, a checklist, a scope note, and a labeled review link." width="626">
  <br><sub>Sent from the CLI with native Block Kit</sub>
</p>

```sh
slack-cli history general --top=10
slack-cli send general "Ready for review"
# Review the content and destination, then approve the send:
slack-cli send general "Ready for review" --allow-write
```

| Read | Compose | Review | Update |
| --- | --- | --- | --- |
| Channels, DMs, followed threads, search, and unread messages | Native bullet lists, Block Kit, files, and thread replies | Inspect resolved IDs and parameters before posting | `slack-cli update` installs a checksum-verified release |

> **Before you install:** This independent tool uses Slack browser-session credentials without an OAuth app.
> Slack changes can break it. Workspace policies and your account permissions still apply.

## Install

Download a binary from [GitHub Releases](https://github.com/LegoGuy32109/agentic-slack-cli/releases/latest), or use the installer on macOS and Linux.
Running a release binary needs no Bun or Node.js.

```sh
curl -fsSLO https://raw.githubusercontent.com/LegoGuy32109/agentic-slack-cli/master/install.sh
sh install.sh
```

The installer downloads the matching binary and verifies its SHA-256 checksum before installation.
It defaults to `~/.local/bin`. Add that folder to your PATH if needed.

<details>
<summary>Platforms and manual installation</summary>

| Machine | Release asset |
| --- | --- |
| Linux x64 | `slack-cli-linux-x64` |
| macOS Apple silicon | `slack-cli-mac-arm64` |
| macOS Intel | `slack-cli-mac-x64` |
| Windows x64 | `slack-cli-windows-x64.exe` |

For Windows, download the executable and `SHA256SUMS` from the same release.
Verify the checksum, rename the executable to `slack-cli.exe`, and place it in a folder on your PATH.
The shell installer supports macOS and Linux only. Native Linux ARM64 and Windows ARM64 builds are not supplied.
Set `SLACK_CLI_BIN` to choose another installation folder.

</details>

## Quick start

1. Open your Slack workspace in a browser and open DevTools.
2. In **Network**, filter requests by `api/`, then copy a Slack API request with **Copy as cURL**.
3. Run the authentication command, paste the request, and end input with Ctrl+D.

```sh
slack-cli auth --profile demo
slack-cli auth status --profile demo
slack-cli history general --top=5 --profile demo
```

The CLI extracts the browser tokens from your pasted request and stores them locally.
Authenticate again when the session expires. See [credentials and profiles](docs/credentials.md) for paths and environment overrides.

Start with a preview:

```sh
slack-cli send general "First draft" --profile demo --json
```

A channel reference can be an ID, a bare visible name, or `#name`.
Use a DM conversation ID for a direct message. A user ID is not a DM destination.
Discover accessible conversations with `slack-cli api conversations.list --params '{"limit":200}'`.

## Rich messages

Use `--format=rich` to turn consecutive `-` or `*` lines into native Slack bullet lists.
Other lines remain text sections. This mode is a small list formatter, not a general Markdown renderer.

```sh
slack-cli send general 'Review checklist:
- Tests passed
- Desktop review pending' --format=rich
```

For a structured update, supply native Block Kit JSON and a text fallback:

```sh
slack-cli send general "Demo release: checks passed, desktop review pending." \
  --blocks @examples/release-blocks.json --json
```

<p align="center">
  <img src="docs/images/code-and-checklist.png" alt="Slack renders two command blocks, an inline approval flag, and a native three-item bullet checklist." width="651">
  <br><sub>Code blocks and a native checklist in Slack</sub>
</p>

The [release example](examples/release-blocks.json) uses a heading, status fields, a review checklist, and a labeled link.
The [code example](examples/code-blocks.json) uses a fenced command block and an inline command.
Add `--allow-write` only after reviewing the destination and content.

| You want | Use |
| --- | --- |
| Native bullet lists | `--format=rich` |
| A structured layout | `--blocks @message.json` |
| A real person mention | `@{Display Name}` in message text |
| A labeled Slack link | `<https://example.com/review|Open review>` in a `mrkdwn` block |
| An attachment | `--file report.md` |
| A reply | `--thread-ts ROOT_TS` |

`@{Name}` resolves to a real mention or fails if the match is missing or ambiguous.
Plain `@Name` stays literal and produces a warning. Raw blocks remain caller-supplied JSON, so use explicit Slack IDs for mentions inside blocks.
See [reproducible examples and screenshot notes](docs/showcase.md).

## Files and threads

Attach a file with an optional comment. Repeat `--file` for several attachments.
Each `--title` applies to the corresponding file.

```sh
slack-cli send general "Demo verification report" \
  --file examples/demo-report.md --title "Demo verification" --json

# After approval, upload and check the posted file IDs and sizes:
slack-cli send general "Demo verification report" \
  --file examples/demo-report.md --title "Demo verification" --verify --allow-write
```

<p align="center">
  <img src="docs/images/file-message.png" alt="Slack previews an uploaded Markdown report with a table of fictional verification results." width="797">
  <br><sub>A Markdown file uploaded with --file and rendered by Slack</sub>
</p>

Previews show each file's path, size, SHA-256, and first line when available. They reserve no upload IDs and upload no bytes.
The CLI rejects empty files and files larger than 1 GiB.
`--verify` checks the posted message for the expected file IDs and sizes. It does not compare downloaded bytes.
Files cannot combine with `--blocks` or `--format=rich` because the upload uses an initial comment.

Use the root message timestamp for a thread reply:

```sh
slack-cli send general "Desktop review is next." --thread-ts 1710000000.000001
```

<details>
<summary>See the thread reply</summary>

<p align="center">
  <img src="docs/images/thread-reply.png" alt="The Slack thread pane shows the release update above a follow-up reply." width="546">
  <br><sub>A follow-up sent with --thread-ts</sub>
</p>

</details>

An uploaded file can outlive its message. Delete the file separately with the previewed `api files.delete` operation when needed.

## Edit a message

```sh
slack-cli edit general 1710000000.000001 "Updated: desktop review passed." --json
```

`edit` supports `--blocks` and `--format=rich`, like `send`. Slack permits edits to your own messages only.
Both commands return a message timestamp and a permalink when Slack supplies one.

## For coding agents

Read commands support `--json`. Use `--content` to include visible block and attachment text when reading messages.
Search results include an `id` in `channelId:ts` format that `context` accepts directly.

```sh
slack-cli search 'in:general release' --count=10 --json
slack-cli context C123:1710000000.000001 --window=4 --content --json
slack-cli unread --content --json
```

`unread` includes channels, group DMs, DMs, followed threads, and file links. Add `--all` to include muted conversations.
Reading does not mark messages read.

Give your agent this instruction:

> Use `slack-cli` to read recent context before drafting a Slack message.
> Preview every write with `--json` and show me the content and destination.
> Only add `--allow-write` after I approve the operation.
> If delivery is uncertain, inspect history before trying again.

Use the `request_ts` from an unread scan as an explicit read boundary:

```sh
slack-cli mark 1710000000.000001 --only general
# After reviewing the preview:
slack-cli mark 1710000000.000001 --only general --allow-write
```

`mark` re-scans unread state and marks conversations and followed threads through that timestamp. It never advances beyond it.
Use `--ignore general` to exclude destinations instead. `--only` and `--ignore` cannot combine.
A native Slack read position already beyond the boundary can move backward. Per-item failures are reported without stopping other items.

Search accepts Slack modifiers such as `in:general`, `from:me`, and `on:2026-11-13`.
`--after` and `--before` add Slack's exclusive date filters.
A query containing `@handle`, `@{Display Name}`, or `<@USERID>` searches mentions of that person.
Slack resolves search mentions server-side. Prefer a unique handle when names collide.

## Slack Lists

Inspect accessible Lists, filter rows, update a typed cell, or reorder a row.
A List reference can be its URL, ID, or exact title.

```sh
slack-cli lists list
slack-cli lists schema "Demo tracker"
slack-cli lists rows "Demo tracker" --where Status=Pending
slack-cli lists update "Demo tracker" --where Task=Docs --column Status --value Done
slack-cli lists move "Demo tracker" --where Task=Docs --after Task=Build
```

Updates and moves preview by default and verify the result through readback after an approved write.
Supported cell types include text, number, date, user, select, and checkbox.
List access depends on your workspace and permissions.

## Direct API access

Inspect the built-in method catalog before making a direct call:

```sh
slack-cli api methods
slack-cli api describe chat.update
slack-cli api conversations.replies --params '{"channel":"general","ts":"1710000000.000001"}'
slack-cli api reactions.add --params '{"channel":"general","timestamp":"1710000000.000001","name":"white_check_mark"}'
```

Catalogued writes preview by default. `--params` accepts inline JSON or `@file.json`, with structured values encoded for Slack's form transport.
Uncatalogued methods require `--unsafe-method` and still preview until `--allow-write` is present.
Browser credentials do not guarantee access to every Slack endpoint.

## Updates

Existing users can install the latest published release with the same command:

```sh
slack-cli update --check
slack-cli update
slack-cli version
```

Updates run only when requested. The CLI selects the matching GitHub release asset and verifies `SHA256SUMS` before replacing its executable.
Credentials and caches stay in place. A checksum mismatch stops replacement, and downgrades require `--force`.
On Windows, replacement finishes after the command exits. Confirm the result with `slack-cli version`.
Checksums detect corruption but do not independently verify publisher identity.

See [release maintenance](docs/maintenance.md) for the maintainer workflow. Unpublished source changes reach installed users only after a new release.

## Command reference

Run `slack-cli --help` for command syntax and common flags.
See the [full reference](docs/commands.md) for read, write, profile, and List options.

## Build and contribute

Requires [Bun](https://bun.com).

```sh
bun install --frozen-lockfile
bun run typecheck
bun test
bun run build
./slack-cli --help
```

Tests use fake credentials and services. Keep tokens, copied requests, browser profiles, and private workspace data out of issues and commits.
