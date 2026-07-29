# agentic-slack-cli

A CLI tool for AI agents to read and search Slack using browser auth tokens. No OAuth app required — authenticate by pasting a curl command copied from Slack's network tab.

## Install

```sh
curl -fsSL https://raw.githubusercontent.com/LegoGuy32109/agentic-slack-cli/master/install.sh | sh
```

Or download a binary directly from the [latest release](https://github.com/LegoGuy32109/agentic-slack-cli/releases/latest):

| Platform | File |
|---|---|
| Linux x64 | `slack-cli-linux-x64` |
| Mac (Apple Silicon) | `slack-cli-mac-arm64` |
| Mac (Intel) | `slack-cli-mac-x64` |
| Windows x64 | `slack-cli-windows-x64.exe` |

## Authentication

The CLI uses Slack's browser tokens (`xoxc` + `xoxd`), which work without installing a Slack app. Released binaries store credentials in your user configuration directory—not alongside the executable or repository:

- Linux: `$XDG_CONFIG_HOME/slack-cli/credentials.json` (or `~/.config/slack-cli/credentials.json`)
- macOS: `~/Library/Application Support/slack-cli/credentials.json`
- Windows: `%APPDATA%\slack-cli\credentials.json`

**How to get your tokens:**

1. Open Slack in Chrome/Brave and open DevTools (F12)
2. Go to the **Network** tab, filter by `api/`
3. Click any Slack API request, right-click → **Copy as cURL**
4. Run:

```sh
slack-cli auth
# paste the curl command, then Ctrl+D
```

Credentials are stored under the selected profile (default: `default`). Re-run `auth` when tokens expire.

```sh
slack-cli auth --profile work
slack-cli auth status
slack-cli config path
slack-cli logout --profile work
```

## Updating

Installed binaries can explicitly check for or install a release update. Updates
download the platform-matched asset, verify its SHA-256 value from the release's
`SHA256SUMS`, and replace only the executable after verification. Credentials,
profiles, and the user cache are not modified. Downgrades require `--force`.

```sh
slack-cli --version
slack-cli update --check
slack-cli update
```

If a system-wide installation is not writable, install to a user-writable path
or rerun the replacement with the required operating-system privileges. The
existing binary is retained if download or verification fails.

### Maintainer release

From a branch whose committed `HEAD` contains the intended changes, run one of:

```sh
bun run release patch
bun run release minor
bun run release major
```

The script runs tests and a compiled build, updates `package.json` and
`src/version.ts`, creates the release commit and annotated tag, then atomically
pushes the branch and tag. It deliberately ignores unrelated unstaged and
untracked files, but refuses to run when either version file has uncommitted
edits. The pushed tag triggers the GitHub release workflow.

For development or agent automation only, environment variables override the stored profile: `SLACK_XOXC_TOKEN`, `SLACK_XOXD_TOKEN`, and optionally `SLACK_WORKSPACE_URL`. A `.env` file is optional in Bun development; production binaries do not require one.

## Commands

```
Read (safe by default)
slack-cli unread [--mentions --threads --files --all]    Show unread messages
slack-cli search <query> [--count=N --window=N]          Search messages
slack-cli context <channelId:ts> ... [--window=N]        Expand selected results
slack-cli history <channelId> [--top=N|--after-ts=TS]    Read a channel or DM chronologically
slack-cli api methods|describe|<method>                  Use a catalogued Slack API method

Write (preview by default; --allow-write mutates)
slack-cli send <channelId> <text>                        Preview or post a message
slack-cli mark <channel> [ts]                            Preview or mark through ts
slack-cli api <write-method> --params JSON               Preview or call a catalogued write method

Setup and maintenance
slack-cli auth [--profile NAME] | auth status             Save or check credentials
slack-cli logout [--profile NAME] | config path           Remove credentials or print their path
slack-cli cache users --refresh                           Refresh the user-name cache
slack-cli users find <query>                              Find user IDs and names
slack-cli update [--check] [--force]                      Check for or install an update
slack-cli version | --version                             Print the installed version
slack-cli help | --help                                   Show the command summary
```

### Flags

```
--json          Output as JSON (great for piping to agents)
--content       Render all visible message content, including attachment prompts
--threads       Include thread replies (unread command)
--mentions      Show only unread direct/@here/@channel mentions
--files         Include file metadata (unread command)
--all           Include muted conversations (unread command)
--count=N       Number of search results (default 20)
--window=N      Hours of conversation to show around each message
                  search default: 0h, context default: 4h
--after=DATE    Add Slack search modifier after:YYYY-MM-DD
--before=DATE   Add Slack search modifier before:YYYY-MM-DD
--profile=NAME  Select a stored credential profile
--refresh-users Refresh the user-name cache before the command
--top=N         Return the newest N messages from history (default: 20)
--after-ts=TS   Return history newer than a timestamp
--params=JSON   Parameters for a direct API method
--blocks=JSON   Raw Block Kit array or @file for send
--format=KIND   Send format: plain (default) or rich
--unsafe-method Permit an API method outside the built-in catalog
--allow-write   Perform a Slack mutation; write commands preview by default
--check         Check for an update without installing it
--force         Permit an update downgrade
```

## Agent Workflow

Search returns an `id` field in `channelId:ts` format that can be passed directly to `context`:

```sh
# Find relevant messages
slack-cli search "from:me deploy issue" --json

# Get full context around a specific message
slack-cli context C049S9AN8DB:1751067908.325309

# Batch multiple messages at once
slack-cli context C049S9AN8DB:1751067908.325309 C049S9AN8DB:1761586752.824909

# Read the latest bot/prompt conversation messages
slack-cli history D0123456789 --top=3 --content --json

# Post only with explicit write safeguards
slack-cli send D0123456789 "Acknowledged" --allow-write

# Preview a resolved write. Omitting --allow-write never sends a Slack message.
slack-cli send developers 'Hi @{Seth Foss}' --json

# Explicit rich-list formatting; plain dash lines remain literal by default.
slack-cli send developers $'Agenda:\n- alpha\n- beta' --format=rich --allow-write

# Send native Block Kit from a JSON array file, while keeping a text fallback.
slack-cli send developers "Deployment update" --blocks @blocks.json --allow-write

# Mark a channel as read through a specific timestamp
slack-cli mark general 1751067908.325309 --allow-write

# Mark the entire channel as read through the time this command starts
slack-cli mark general --allow-write
```

Search supports Slack modifiers: `in:channel`, `from:user`, `after:2026-01-01`, `before:2026-12-31`

## Advanced: direct Slack API calls

Use `api` when a Slack API method does not have a dedicated command. It uses the same stored profile and browser credentials, so agents never need to expose tokens in cURL commands. Responses are raw JSON and can contain Slack IDs.

```sh
slack-cli api methods
slack-cli api describe conversations.history
slack-cli api users.info --params '{"user":"U123"}' --json
slack-cli api conversations.history --params '{"channel":"C123","limit":100}' --json
slack-cli api reactions.add --params '{"channel":"C123","timestamp":"1710000000.000001","name":"white_check_mark"}' --allow-write

# Params may be inline JSON or a file. Arrays and objects are encoded correctly.
slack-cli api chat.postMessage --params @message.json --allow-write
```

The built-in catalog starts read-only. Catalogued writes preview by default and run only with `--allow-write`. Methods outside the catalog require `--unsafe-method`; they also preview by default because the CLI cannot verify whether they mutate:

```sh
slack-cli api conversations.mark \
  --params '{"channel":"C123","ts":"1710000000.000001"}' \
  --allow-write
```

Check the official [Slack Web API method reference](https://api.slack.com/methods) for current parameters, pagination, and complete behavior. Browser-session credentials may not work with every public Slack API method.

### References, mentions, and write previews

Commands that take a channel accept an ID, a bare visible channel name, or `#name`.
Known direct API methods resolve their `channel` parameter the same way. Use `users find
"Seth Foss"` to inspect available identities. In `send` text, `@{Seth Foss}` resolves to a
real Slack mention; the command refuses ambiguous or missing matches rather than guessing.

Every write path resolves references and prints the normalized parameters plus the form-encoded
wire representation by default, but never calls the write endpoint until `--allow-write` is present.

## Build from Source

Requires [Bun](https://bun.com).

```sh
git clone https://github.com/LegoGuy32109/agentic-slack-cli
cd agentic-slack-cli
bun install
bun run build        # current platform
bun run build:linux  # Linux x64
bun run build:mac    # Mac arm64
bun run build:win    # Windows x64
```
