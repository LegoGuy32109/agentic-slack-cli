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

For development or agent automation only, environment variables override the stored profile: `SLACK_XOXC_TOKEN`, `SLACK_XOXD_TOKEN`, and optionally `SLACK_WORKSPACE_URL`. A `.env` file is optional in Bun development; production binaries do not require one.

## Commands

```
slack-cli unread                        Show all unread messages
slack-cli search <query>                Search messages with surrounding context
slack-cli context <channelId:ts> ...    Fetch full context for one or more messages
slack-cli mark <channel> <ts>           Mark a channel as read up to a timestamp
slack-cli cache users --refresh          Refresh the persistent user-name cache
slack-cli api methods                    List supported direct API methods
```

### Flags

```
--json          Output as JSON (great for piping to agents)
--threads       Include thread replies (unread command)
--mentions      Show only unread direct/@here/@channel mentions
--files         Include file metadata (unread command)
--all           Include muted conversations (unread command)
--count=N       Number of search results (default 20)
--window=N      Hours of conversation to show around each message
                  search default: 1h, context default: 4h
--after=DATE    Add Slack search modifier after:YYYY-MM-DD
--before=DATE   Add Slack search modifier before:YYYY-MM-DD
--profile=NAME  Select a stored credential profile
--refresh-users Refresh the user-name cache before the command
```

## Agent Workflow

Search returns an `id` field in `channelId:ts` format that can be passed directly to `context`:

```sh
# Find relevant messages
slack-cli search "deploy issue" --json

# Get full context around a specific message
slack-cli context C049S9AN8DB:1751067908.325309

# Batch multiple messages at once
slack-cli context C049S9AN8DB:1751067908.325309 C049S9AN8DB:1761586752.824909

# Mark a channel as read
slack-cli mark general 1751067908.325309
```

Search supports Slack modifiers: `in:channel`, `from:user`, `after:2026-01-01`, `before:2026-12-31`

## Advanced: direct Slack API calls

Use `api` when a Slack API method does not have a dedicated command. It uses the same stored profile and browser credentials, so agents never need to expose tokens in cURL commands. Responses are raw JSON and can contain Slack IDs.

```sh
slack-cli api methods
slack-cli api describe conversations.history
slack-cli api users.info --params '{"user":"U123"}' --json
slack-cli api conversations.history --params '{"channel":"C123","limit":100}' --json
```

The built-in catalog starts read-only. Methods outside it require `--unsafe-method`; mutations additionally require both `--allow-write` and `--yes`:

```sh
slack-cli api conversations.mark \
  --params '{"channel":"C123","ts":"1710000000.000001"}' \
  --allow-write --yes
```

Check the official [Slack Web API method reference](https://api.slack.com/methods) for current parameters, pagination, and complete behavior. Browser-session credentials may not work with every public Slack API method.

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
