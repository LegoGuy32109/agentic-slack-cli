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

The CLI uses Slack's browser tokens (`xoxc` + `xoxd`), which work without installing a Slack app.

**How to get your tokens:**

1. Open Slack in Chrome/Brave and open DevTools (F12)
2. Go to the **Network** tab, filter by `api/`
3. Click any Slack API request, right-click → **Copy as cURL**
4. Run:

```sh
slack-cli auth
# paste the curl command, then Ctrl+D
```

Tokens are saved to `.env` in the current directory. Re-run `auth` when tokens expire.

## Commands

```
slack-cli unread                        Show all unread messages
slack-cli search <query>                Search messages with surrounding context
slack-cli context <channelId:ts> ...    Fetch full context for one or more messages
slack-cli mark <channel> <ts>           Mark a channel as read up to a timestamp
```

### Flags

```
--json          Output as JSON (great for piping to agents)
--threads       Include thread replies (unread command)
--all           Include muted conversations (unread command)
--count=N       Number of search results (default 20)
--window=N      Hours of conversation to show around each message
                  search default: 1h, context default: 4h
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
