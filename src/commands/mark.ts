import { call } from "../client.ts";
import { resolveChannel } from "../references.ts";

function markTimestamp(value: string | undefined, now = Date.now()): string {
  if (value === undefined) return (now / 1000).toFixed(6);
  if (!/^\d+(?:\.\d+)?$/.test(value) || Number(value) <= 0) {
    throw new Error(`Invalid timestamp "${value}". Use a Unix timestamp such as 1710000000.000001, or omit it to mark through now.`);
  }
  return value;
}

export async function mark(nameOrId: string, inputTs: string | undefined, opts: { allowWrite: boolean }) {
  if (!nameOrId) {
    throw new Error("Usage: slack-cli mark <channel-name-or-id> [ts] --allow-write\nOmit ts to mark the entire channel as read through the time this command started.");
  }
  const ts = markTimestamp(inputTs);
  const channel = await resolveChannel(nameOrId);
  const through = new Date(Number(ts) * 1000).toLocaleString();
  if (!opts.allowWrite) {
    console.log(`Dry run: would mark ${channel.label} (${channel.id}) as read through ${through} (ts ${ts}).\nRe-run with --allow-write to perform this Slack write.`);
    return;
  }

  await call("conversations.mark", { channel: channel.id, ts });
  console.log(`Marked ${channel.label} as read through ${through} (ts ${ts}).`);
}

export const markInternals = { markTimestamp };
