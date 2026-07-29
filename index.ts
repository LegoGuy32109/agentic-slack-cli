import { api, apiDescribe, apiMethods } from "./src/commands/api.ts";
import { auth } from "./src/commands/auth.ts";
import { context } from "./src/commands/context.ts";
import { history } from "./src/commands/history.ts";
import { mark } from "./src/commands/mark.ts";
import { search } from "./src/commands/search.ts";
import { send } from "./src/commands/send.ts";
import { usersFind } from "./src/commands/users.ts";
import { update } from "./src/commands/update.ts";
import { VERSION } from "./src/version.ts";
import { unread } from "./src/commands/unread.ts";
import { credentialStatus, currentUserId, refreshUsers } from "./src/client.ts";
import { credentialsPath, removeCredentials } from "./src/config.ts";

const args = process.argv.slice(2);
const command = args[0];
const rest = args.slice(1);
const consumed = new Set<number>();
let parseError: string | undefined;

const flagSpecs = {
  json: false, content: false, threads: false, files: false, mentions: false, all: false,
  count: true, window: true, after: true, before: true, top: true, "after-ts": true,
  profile: true, "refresh-users": false, "allow-write": false, force: false, check: false,
  params: true, blocks: true, format: true, "unsafe-method": false, refresh: false,
} as const;
type FlagName = keyof typeof flagSpecs;

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
  if (index >= 0) parseError ??= `--${name} requires a value.`;
  return undefined;
}
function number(name: string, fallback: number): number {
  const raw = value(name);
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) parseError ??= `--${name} must be a number.`;
  return Number.isFinite(parsed) ? parsed : fallback;
}
function date(name: string): string | undefined {
  const raw = value(name);
  if (raw !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    parseError ??= `--${name} must use YYYY-MM-DD.`;
    return undefined;
  }
  return raw;
}
const profile = value("profile");
const topRaw = value("top");
const afterTs = value("after-ts");
const params = value("params");
const blocks = value("blocks");
const format = value("format");
const opts = {
  json: flag("json"), threads: flag("threads"), files: flag("files"), mentions: flag("mentions"), all: flag("all"),
  count: number("count", 20), window: number("window", -1), after: date("after"), before: date("before"),
  top: topRaw === undefined ? undefined : Number(topRaw), afterTs, content: flag("content"),
  allowWrite: flag("allow-write"),
  force: flag("force"), check: flag("check"),
  blocks, format,
};
const positional = rest.filter((arg, index) => !arg.startsWith("--") && !consumed.has(index));

function invocationError(message: string): never {
  throw new Error(`${message}\nRun \`slack-cli --help\` to see valid commands and flags.`);
}

function validateFlags(allowed: FlagName[]) {
  const allowedSet = new Set<string>(allowed);
  for (const arg of rest) {
    if (!arg.startsWith("--")) continue;
    const [name, inlineValue] = arg.slice(2).split("=", 2);
    if (!name || !(name in flagSpecs)) invocationError(`Unknown flag \`${arg}\`.`);
    const expectsValue = flagSpecs[name as FlagName];
    if (!expectsValue && inlineValue !== undefined) invocationError(`Flag \`--${name}\` does not take a value.`);
    if (!allowedSet.has(name)) invocationError(`Flag \`--${name}\` is not valid with \`slack-cli ${command}\`.`);
  }
}

function requirePositionals(minimum: number, maximum: number, usage: string) {
  if (positional.length < minimum || positional.length > maximum) invocationError(`Usage: ${usage}`);
}

function validateInvocation() {
  const shared = ["profile"] as FlagName[];
  switch (command) {
    case "auth":
      validateFlags(shared);
      if (positional[0] === "status") requirePositionals(1, 1, "slack-cli auth status [--profile NAME]");
      return;
    case "logout": validateFlags(shared); return requirePositionals(0, 0, "slack-cli logout [--profile NAME]");
    case "config": validateFlags([]); if (positional[0] !== "path") invocationError("Usage: slack-cli config path"); return requirePositionals(1, 1, "slack-cli config path");
    case "cache": validateFlags(["refresh"]); if (positional[0] !== "users" || !flag("refresh")) invocationError("Usage: slack-cli cache users --refresh"); return requirePositionals(1, 1, "slack-cli cache users --refresh");
    case "users": validateFlags(["json", ...shared]); if (positional[0] !== "find") invocationError("Usage: slack-cli users find <query>"); return requirePositionals(2, Infinity, "slack-cli users find <query>");
    case "unread": validateFlags(["json", "content", "threads", "files", "mentions", "all", ...shared, "refresh-users"]); return requirePositionals(0, 0, "slack-cli unread [--mentions --threads --files --all]");
    case "search": validateFlags(["json", "content", "count", "window", "after", "before", ...shared, "refresh-users"]); return requirePositionals(1, Infinity, "slack-cli search <query> [--count=N --window=N]");
    case "context": validateFlags(["json", "content", "window", ...shared, "refresh-users"]); return requirePositionals(1, Infinity, "slack-cli context <channelId:ts> ... [--window=N]");
    case "history": validateFlags(["json", "content", "top", "after-ts", ...shared, "refresh-users"]); return requirePositionals(1, 1, "slack-cli history <channelId> [--top=N|--after-ts=TS]");
    case "send": validateFlags(["json", "allow-write", "blocks", "format", ...shared]); return requirePositionals(2, Infinity, "slack-cli send <channel> <text> [--allow-write]");
    case "mark": validateFlags(["allow-write", ...shared]); return requirePositionals(1, 2, "slack-cli mark <channel-name-or-id> [ts] [--allow-write]");
    case "update": validateFlags(["check", "force"]); return requirePositionals(0, 0, "slack-cli update [--check] [--force]");
    case "api": {
      validateFlags(["json", "params", "unsafe-method", "allow-write", ...shared]);
      if (positional[0] === "methods") return requirePositionals(1, 1, "slack-cli api methods");
      if (positional[0] === "describe") return requirePositionals(2, 2, "slack-cli api describe <method>");
      return requirePositionals(1, 1, "slack-cli api <method> --params JSON");
    }
    case "version": validateFlags([]); return requirePositionals(0, 0, "slack-cli version");
    default: invocationError(`Unknown command \`${command}\`.`);
  }
}

async function pastedCurl(): Promise<string> {
  if (positional.length) return positional.join(" ");
  process.stdout.write("Paste curl command (then press Ctrl+D):\n");
  const chunks: Buffer[] = [];
  for await (const chunk of Bun.stdin.stream()) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString();
}

function usage() {
  console.log(`slack-cli ${VERSION} — search and manage Slack with browser-session credentials

Usage: slack-cli <command> [flags]

Read (safe by default):
  unread [--mentions --threads --files --all]    Show unread messages
  search <query> [--count=N --window=N]          Search; use --json for agent output
  context <channelId:ts> ... [--window=N]        Expand selected search results
  history <channelId> [--top=N|--after-ts=TS]    Read a channel or DM chronologically
  api methods|describe|<method>                  Use a catalogued Slack API method

Write (preview by default; --allow-write mutates):
  send <channelId> <text>                        Preview or post a message
  mark <channel> [ts]                             Preview or mark through ts
  api <write-method> --params JSON                Preview or call a catalogued write method

Setup and maintenance:
  auth [--profile NAME] | auth status             Save or check credentials
  logout [--profile NAME] | config path           Remove credentials or print their path
  cache users --refresh                           Rebuild the user-name cache
  users find <query>                              Find a user ID, display name, or handle
  update [--check] [--force]                      Check for or install a verified binary update
  version | --version                             Print the installed version

Common flags:
  --json --content --profile=NAME --refresh-users
  --after=YYYY-MM-DD --before=YYYY-MM-DD          search only
  --allow-write                                   perform a write (writes preview by default)

Use --help for this summary. Use \`api methods\` or \`api describe <method>\`
before calling the direct API; unknown methods require --unsafe-method and preview by default.`);
}

async function main() {
  if (!command) return usage();
  if (parseError) invocationError(parseError);
  if (command === "--help" || command === "-h" || command === "help") {
    if (rest.length) invocationError("Usage: slack-cli --help");
    return usage();
  }
  if (command === "--version") {
    if (rest.length) invocationError("Usage: slack-cli --version");
    return console.log(VERSION);
  }
  validateInvocation();
  if (command === "version") return console.log(VERSION);
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
  if (command === "users" && positional[0] === "find") return usersFind(positional.slice(1).join(" "), opts.json);
  if (flag("refresh-users")) console.log(`Refreshed ${await refreshUsers()} users.`);
  if (command === "unread") return unread(opts);
  if (command === "mark") return mark(positional[0] || "", positional[1], opts);
  if (command === "search") return search(positional.join(" "), { ...opts, window: opts.window < 0 ? 0 : opts.window });
  if (command === "context") return context(positional, { ...opts, window: opts.window < 0 ? 4 : opts.window });
  if (command === "history") return history(positional[0] || "", { json: opts.json, top: opts.top, afterTs: opts.afterTs, content: opts.content });
  if (command === "send") return send(positional[0] || "", positional.slice(1).join(" "), opts);
  if (command === "update") return update({ check: opts.check, force: opts.force });
  if (command === "api") {
    const method = positional[0];
    if (method === "methods") return console.log(JSON.stringify(apiMethods(), null, 2));
    if (method === "describe") return console.log(JSON.stringify(apiDescribe(positional[1] || "") || { error: "Unknown catalog method" }, null, 2));
    try {
      console.log(JSON.stringify(await api(method!, params, { unsafe: flag("unsafe-method"), allowWrite: flag("allow-write") }), null, 2));
    } catch (error) {
      console.log(JSON.stringify({ ok: false, method, error: error instanceof Error ? error.message : String(error) }, null, 2));
      process.exitCode = 1;
    }
    return;
  }
}

main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
