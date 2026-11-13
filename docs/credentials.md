# Credentials and profiles

The CLI uses Slack browser tokens (`xoxc` and `xoxd`). Treat a copied request as credentials.
Paste it only into the local authentication command. Never include it in screenshots, issues, or source control.

```sh
slack-cli auth --profile demo
slack-cli auth status --profile demo
slack-cli config path
slack-cli logout --profile demo
```

Authentication stores the selected profile and makes it active. `--profile NAME` selects another stored profile for one command.
Tokens are stored as plaintext credentials with restrictive file permissions where supported.
Re-run authentication when Slack expires the session.

| Platform | Credentials file |
| --- | --- |
| Linux | `$XDG_CONFIG_HOME/slack-cli/credentials.json`, or `~/.config/slack-cli/credentials.json` |
| macOS | `~/Library/Application Support/slack-cli/credentials.json` |
| Windows | `%APPDATA%\slack-cli\credentials.json` |

`SLACK_XOXC_TOKEN` and `SLACK_XOXD_TOKEN` together override stored credentials, including an explicit `--profile`.
`SLACK_WORKSPACE_URL` supplies the workspace URL for that override.
Unset these variables when testing a stored demo profile. Bun can also load them from a local `.env` file, including when running a compiled binary.
If a valid profile unexpectedly fails, run from a directory without that override.
Compiled binaries do not require an `.env` file.
