import { unread } from "./src/commands/unread.ts";
import { mark } from "./src/commands/mark.ts";
import { search } from "./src/commands/search.ts";
import { context } from "./src/commands/context.ts";
import { auth } from "./src/commands/auth.ts";

const args = process.argv.slice(2);
const command = args[0];

const flagArgs = args.slice(1).filter(a => a.startsWith("--"));
const posArgs = args.slice(1).filter(a => !a.startsWith("--"));
const flags = new Set(flagArgs);

function flag(name: string, defaultVal: number): number;
function flag(name: string, defaultVal: boolean): boolean;
function flag(name: string, defaultVal: any): any {
  if (typeof defaultVal === "boolean") return flags.has(`--${name}`);
  const f = flagArgs.find(a => a.startsWith(`--${name}=`));
  return f ? parseFloat(f.split("=")[1] ?? '') : defaultVal;
}

const opts = {
  json: flag("json", false),
  threads: flag("threads", false),
  all: flag("all", false),
  count: flag("count", 20),
  window: flag("window", -1), // -1 = use command default
};

async function main() {
switch (command) {
  case "auth":
    await auth(posArgs.join(" ") || await (async () => {
      process.stdout.write("Paste curl command (then press Ctrl+D):\n");
      const chunks: Buffer[] = [];
      for await (const chunk of Bun.stdin.stream()) chunks.push(Buffer.from(chunk));
      return Buffer.concat(chunks).toString();
    })());
    break;

  case "unread":
    await unread(opts);
    break;

  case "mark":
    await mark(posArgs[0] ?? "", posArgs[1] ?? "");
    break;

  case "search":
    await search(posArgs.join(" "), { ...opts, window: opts.window < 0 ? 1 : opts.window });
    break;

  case "context":
    await context(posArgs, { ...opts, window: opts.window < 0 ? 4 : opts.window });
    break;

  default:
    console.log(`Usage: slack <command> [flags]

Commands:
  auth                          Save tokens from a pasted Slack curl command
  unread                        Show all unread messages
  mark <channel> <ts>           Mark a channel as read up to a timestamp
  search <query>                Search messages, with surrounding context
  context <channelId:ts> ...    Fetch full context for one or more messages

Flags:
  --json                        Output as JSON
  --threads                     Include thread replies (unread)
  --all                         Include muted conversations (unread)
  --count=N                     Number of search results (default 20)
  --window=N                    Hours of conversation to show around each message
                                  search default: 1h, context default: 4h
`);
}
}

main();
