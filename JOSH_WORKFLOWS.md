# Josh workflows

These workflows are tailored to Josh and the GEOH Slack/Jira setup. They are
instructions for an agent; they do not authorize posting or marking messages.

## Daily standup research

1. Determine the prior workday in the authenticated Slack user's timezone.
   `search` resolves `from:me` from the authenticated identity and applies
   `--after` inclusively and `--before` exclusively in that stored timezone.

2. Gather candidate messages without surrounding conversation noise:

   ```sh
   bun run index.ts search 'from:me' \
     --after=YYYY-MM-DD --before=YYYY-MM-DD \
     --count=100 --json
   ```

3. Select only messages that describe work, decisions, code review, tickets,
   or coordination. Expand those IDs together; do not expand every result.

   ```sh
   bun run index.ts context CHANNEL_ID:TIMESTAMP CHANNEL_ID:TIMESTAMP \
     --window=2 --content --json
   ```

4. Cross-check Jira assignments updated during that period:

   ```sh
   jira issue list --plain --no-truncate \
     --columns KEY,SUMMARY,STATUS,UPDATED \
     -q 'assignee = currentUser() AND updated >= "YYYY-MM-DD" AND updated < "YYYY-MM-DD"'
   ```

   Use `jira issue view ISSUE-KEY` to inspect an item before saying it was
   completed. An `UPDATED` timestamp corroborates activity; it is not proof of
   who performed the work.

5. Draft short responses using only retrieved evidence. Do not send them until
   Josh explicitly directs the agent to post.

## Standup and Prosper DM

The app can put its visible prompt in an attachment rather than `text`. The
CLI's `content` field includes attachment fallbacks and fields, and `--content`
uses that field in normal output.

```sh
# Read the latest message sequence in chronological order.
bun run index.ts history D0A480TTP5Z --top=3 --content --json

# Only after explicit direction, send one approved response.
bun run index.ts send D0A480TTP5Z 'approved one-paragraph response' --allow-write --yes

# Poll for the bot's next question.
bun run index.ts history D0A480TTP5Z --top=3 --content --json
```

The recurring prompts are normally: what was done yesterday, what is planned
today, and whether there are blockers. Read the returned `content` before
choosing a response; do not assume the question or send multiple answers at
once.
