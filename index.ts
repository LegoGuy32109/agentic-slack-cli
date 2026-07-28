import { api, apiDescribe, apiMethods } from "./src/commands/api.ts";
import { auth } from "./src/commands/auth.ts";
import { context } from "./src/commands/context.ts";
import { history } from "./src/commands/history.ts";
import { mark } from "./src/commands/mark.ts";
import { search } from "./src/commands/search.ts";
import { send } from "./src/commands/send.ts";
import { update } from "./src/commands/update.ts";
import { VERSION } from "./src/version.ts";
import { unread } from "./src/commands/unread.ts";
import { credentialStatus, currentUserId, refreshUsers } from "./src/client.ts";
import { credentialsPath, removeCredentials } from "./src/config.ts";

const args = process.argv.slice(2);
const command = args[0];
const rest = args.slice(1);
const consumed = new Set<number>();

function flag(name: string): boolean { return rest.includes(`--${name}`); }
function value(name: string): string | undefined {
  const inline = rest.find(arg => arg.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);
  const index = rest.indexOf(`--${name}`);
  const next = index >= 0 ? rest[index + 1] : undefined;
  if (next && !next.startsWith("--")) {
    consumed.add(index + 1);
    return next;
  }
  return undefined;
}
function number(name: string, fallback: number): number { const raw = value(name); return raw === undefined ? fallback : Number(raw); }
function date(name: string): string | undefined {
  const raw = value(name);
  if (raw !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw new Error(`--${name} must use YYYY-MM-DD.`);
  return raw;
}
const profile = value("profile");
const topRaw = value("top");
const afterTs = value("after-ts");
const opts = {
  json: flag("json"), threads: flag("threads"), files: flag("files"), mentions: flag("mentions"), all: flag("all"),
  count: number("count", 20), window: number("window", -1), after: date("after"), before: date("before"),
  top: topRaw === undefined ? undefined : Number(topRaw), afterTs, content: flag("content"),
  allowWrite: flag("allow-write"), yes: flag("yes"),
  force: flag("force"), check: flag("check"),
};
const positional = rest.filter((arg, index) => !arg.startsWith("--") && !consumed.has(index));

async function pastedCurl(): Promise<string> {
  if (positional.length) return positional.join(" ");
  process.stdout.write("Paste curl command (then press Ctrl+D):\n");
  const chunks: Buffer[] = [];
  for await (const chunk of Bun.stdin.stream()) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString();
}

function usage() {
  console.log(`Usage: slack-cli <command> [flags]

Commands:
  auth [--profile NAME]             Save browser credentials in the OS config directory
  auth status                       Show selected credential status
  logout [--profile NAME]           Remove one stored profile
  config path                       Print the production credential path
  cache users --refresh             Rebuild the persistent user-name cache
  unread                            Show unread messages
  search <query>                    Search messages with context
  context <channelId:ts> ...        Fetch full context
  history <channelId>               Read recent normalized conversation messages
  send <channelId> <text>           Post a message (requires --allow-write --yes)
  update [--check]                  Check for or install a verified binary update
  mark <channel> <ts>               Mark a channel as read
  api methods|describe|<method>     Guarded direct Slack API access

Flags: --json --content --threads --files --mentions --all --count=N --window=N
       --after=YYYY-MM-DD --before=YYYY-MM-DD --top=N --after-ts=TS
       --profile=NAME --refresh-users --allow-write --yes --force`);
}

async function main() {
  if (command === "--version" || command === "version") return console.log(VERSION);
  if (command === "auth" && positional[0] === "status") {
    const status = await credentialStatus();
    const test = await currentUserId();
    console.log(JSON.stringify({ ...status, userId: test, auth: "ok" }, null, 2));
    return;
  }
  if (command === "auth") return auth(await pastedCurl(), profile || "default");
  if (command === "logout") {
    console.log(await removeCredentials(profile) ? "Profile removed." : "No matching stored profile.");
    return;
  }
  if (command === "config" && positional[0] === "path") return console.log(credentialsPath());
  if (command === "cache" && positional[0] === "users" && flag("refresh")) {
    console.log(`Refreshed ${await refreshUsers()} users.`); return;
  }
  if (flag("refresh-users")) console.log(`Refreshed ${await refreshUsers()} users.`);
  if (command === "unread") return unread(opts);
  if (command === "mark") return mark(positional[0] || "", positional[1] || "");
  if (command === "search") return search(positional.join(" "), { ...opts, window: opts.window < 0 ? 0 : opts.window });
  if (command === "context") return context(positional, { ...opts, window: opts.window < 0 ? 4 : opts.window });
  if (command === "history") return history(positional[0] || "", { json: opts.json, top: opts.top, afterTs: opts.afterTs, content: opts.content });
  if (command === "send") return send(positional[0] || "", positional.slice(1).join(" "), opts);
  if (command === "update") return update({ check: opts.check, force: opts.force });
  if (command === "api") {
    const method = positional[0];
    if (method === "methods") return console.log(JSON.stringify(apiMethods(), null, 2));
    if (method === "describe") return console.log(JSON.stringify(apiDescribe(positional[1] || "") || { error: "Unknown catalog method" }, null, 2));
    if (!method) throw new Error("Usage: slack-cli api <method> --params '{\"key\":\"value\"}' --json");
    try {
      console.log(JSON.stringify(await api(method, value("params"), { unsafe: flag("unsafe-method"), allowWrite: flag("allow-write"), yes: flag("yes") }), null, 2));
    } catch (error) {
      console.log(JSON.stringify({ ok: false, method, error: error instanceof Error ? error.message : String(error) }, null, 2));
      process.exitCode = 1;
    }
    return;
  }
  usage();
}

main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
