# Screenshots and examples

These examples use a fictional Orbit project and synthetic results. They contain no person mentions or private project links.
Capture messages posted by this CLI in the approved demo workspace and rendered by Slack.
Do not substitute a mockup for a Slack screenshot.

## Review the drafts

From the repository root, preview the structured release update:

```sh
slack-cli send general "Demo release: checks passed, desktop review pending." \
  --blocks @examples/release-blocks.json --profile demo --json
```

Preview the command example:

```sh
slack-cli send general "Demo commands: read context and preview a draft." \
  --blocks @examples/code-blocks.json --profile demo --json
```

Preview a file attachment:

```sh
slack-cli send general "Demo verification report" \
  --file examples/demo-report.md --title "Orbit verification (demo)" --profile demo --json
```

Confirm the workspace with `auth status --profile demo` before posting.
Environment token overrides take precedence over `--profile`, so remove those overrides before a demo.
After content and destination approval, repeat each chosen command with `--allow-write`.
Use the root timestamp from the release message receipt to preview this reply:

```sh
slack-cli send general "Demo follow-up: desktop review is next. No production changes." \
  --thread-ts ROOT_TS --profile demo --json
```

## Capture guide

| Image | Frame |
| --- | --- |
| `release-message.png` | Heading, status fields, checklist, scope, and example link |
| `code-and-checklist.png` | Both command blocks, the approval instruction, and the native checklist |
| `file-message.png` | File comment and complete report attachment card |
| `thread-reply.png` | Release root and its follow-up in the open thread pane |


Keep the demo labels visible. Use one Slack theme and enough width to read the whole message.
Crop account details and unrelated navigation. Never show copied requests or tokens.
Store reviewed captures in `docs/images/`, then place them in the matching README sections using the Teams README's centered image style.
The README includes four original Slack captures supplied on November 13, 2026.
They show dark theme, including a combined code and native checklist capture.
The thread pane stacks the status fields at its narrower width.

## Crop boundaries

For the release message, start above the Orbit heading and end below the example review link.
For the code message, include its heading, both command blocks, and the final approval instruction.
For the file message, include the comment and the entire attachment card with its filename.
Optional captures can show the native checklist or the release root and follow-up in an open thread pane.
Use a readable width, about 600 to 800 pixels for a single message. Keep a little padding around the content.
Keep demo labels visible and crop unrelated navigation and hover controls.

The CLI posted these examples and confirmed their content through API readback on November 13, 2026.
All four supplied screenshots were visually reviewed before inclusion.
They confirm the displayed examples in the captured Slack client and theme. They do not establish rendering across other clients.
