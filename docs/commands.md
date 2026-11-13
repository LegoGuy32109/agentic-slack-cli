# Command reference

```
Read (safe by default)
slack-cli unread [--all]                                 Show every unread message: channels, groups, DMs, and followed threads, files as links
slack-cli search <query> [--count=N --window=N]          Search messages
slack-cli context <channelId:ts> ... [--window=N]        Expand selected results
slack-cli history <channelId> [--top=N|--after-ts=TS]    Read a channel or DM chronologically
slack-cli api methods|describe|<method>                  Use a catalogued Slack API method
slack-cli lists list                                        Show accessible Slack Lists
slack-cli lists schema|rows <list-url-or-id-or-title>      Inspect a List schema or rows

Write (preview by default; --allow-write mutates)
slack-cli send <channelId> <text>                        Preview or post a message
slack-cli send <channelId> [text] --file PATH              Preview or upload files
slack-cli edit <channelId> <ts> <text>                     Preview or edit your own message
slack-cli mark <ts> [--only ch,ch] [--ignore ch,ch]      Mark everything unread through ts; never advances past ts
slack-cli api <write-method> --params JSON               Preview or call a catalogued write method
slack-cli lists update <list> --where X=Y --column X ... Preview or change one List cell
slack-cli lists move <list> --where X=Y --after X=Y       Preview or reorder one List row

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
--all           Include muted conversations (unread command)
--only=ch,ch    Restrict mark to these channels/DMs (name or ID, comma-separated)
--ignore=ch,ch  Exclude these channels/DMs from mark (mutually exclusive with --only)
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
--cells=JSON    List update payload: {"cells":[...]}
--where=COL=VALUE  Match one List row for an update or filter List rows
--after=COL=VALUE  Place a matched List row immediately after this row
--column=COL    Schema column to update
--value=VALUE   Typed value to set on a List cell
--clear         Clear a supported List cell
--blocks=JSON   Raw Block Kit array or @file for send and edit
--file=PATH     Attach a file (repeatable, send only)
--title=NAME    File title, paired positionally with --file
--thread-ts=TS  Reply under the root timestamp (send only)
--verify        Read back uploaded file IDs and sizes (send --file only)
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
slack-cli context C123:1751067908.325309

# Batch multiple messages at once
slack-cli context C123:1751067908.325309 C123:1761586752.824909

# Read the latest bot/prompt conversation messages
slack-cli history D0123456789 --top=3 --content --json

# Post only with explicit write safeguards
slack-cli send D0123456789 "Acknowledged" --allow-write

# Preview a resolved write. Omitting --allow-write never sends a Slack message.
slack-cli send general 'Hi @{Demo User}' --json

# Explicit rich-list formatting; plain dash lines remain literal by default.
slack-cli send general $'Agenda:\n- alpha\n- beta' --format=rich --allow-write

# Send native Block Kit from a JSON array file, while keeping a text fallback.
slack-cli send general "Deployment update" --blocks @blocks.json --allow-write

# Show everything unread, note the printed request_ts
slack-cli unread

# Mark exactly what that scan covered, and nothing that arrived after it, as read
slack-cli mark 1751067908.325309 --allow-write

# Mark everything read through that point except one channel you're still triaging
slack-cli mark 1751067908.325309 --ignore support --allow-write

# Mark only specific channels/DMs through that point
slack-cli mark 1751067908.325309 --only general,demo --allow-write
```

`mark` re-scans unread state at call time rather than trusting a stored list, but this
is still safe: no write it makes can move a conversation's read cursor past `ts`, so
anything with a later timestamp, a message that arrived after the `unread` scan ran, or
a conversation that was never shown, keeps its own timestamp past the boundary and stays
unread regardless. It writes both channel-level unreads (`conversations.mark`) and
followed-thread unreads (`subscriptions.thread.mark`, Slack's separate Threads-view
unread surface), and keeps going past individual failures, reporting per-item outcomes.
It does not guard against moving a cursor backward if you've already read further ahead
natively in Slack itself, that's an accepted, rare cost, not something this command
checks for.

Search supports Slack modifiers: `in:channel`, `from:user`, `after:2026-01-01`, `before:2026-12-31`.
`@handle`, `@{Display Name}`, or `<@USERID>` anywhere in the query filters to messages
mentioning that user, for anyone in the workspace, not just yourself. Slack resolves the
mention server-side, so a display name that collides with someone else is Slack's call,
not this tool's, prefer a unique handle when it matters.

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
"Demo User"` to inspect available identities. In `send` text, `@{Demo User}` resolves to a
real Slack mention; the command refuses ambiguous or missing matches rather than guessing.

Every JSON write preview resolves references and prints the normalized parameters plus the form-encoded
wire representation where relevant, but never calls the write endpoint until `--allow-write` is present.

