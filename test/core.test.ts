import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { apiDescribe, apiMethods } from "../src/commands/api.ts";
import { decodeXoxd } from "../src/config.ts";
import { mentionIds, renderMentions } from "../src/client.ts";
import { resolveCachedUsers } from "../src/user-cache.ts";

const originalCache = process.env.XDG_CACHE_HOME;
const temporaryDirs: string[] = [];
afterEach(async () => {
  process.env.XDG_CACHE_HOME = originalCache;
  await Promise.all(temporaryDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

describe("credential and message helpers", () => {
  test("decodes encoded xoxd values without breaking raw values", () => {
    expect(decodeXoxd("xoxd-a%2Fb%2Bc")).toBe("xoxd-a/b+c");
    expect(decodeXoxd("xoxd-raw")).toBe("xoxd-raw");
  });

  test("finds and renders Slack user mentions", () => {
    expect(mentionIds("hi <@U1> and <@U2|legacy>")).toEqual(["U1", "U2"]);
    expect(renderMentions("hi <@U1>", { U1: "Ada" })).toBe("hi @Ada");
  });

  test("persists user cache and avoids repeated lookups", async () => {
    const dir = await mkdtemp(join(tmpdir(), "slack-cli-test-"));
    temporaryDirs.push(dir);
    process.env.XDG_CACHE_HOME = dir;
    let lookups = 0;
    const lookup = async (id: string) => { lookups++; return id === "U1" ? "Ada" : undefined; };
    expect(await resolveCachedUsers("https://example.slack.com", ["U1"], lookup)).toEqual({ U1: "Ada" });
    expect(await resolveCachedUsers("https://example.slack.com", ["U1"], lookup)).toEqual({ U1: "Ada" });
    expect(lookups).toBe(1);
  });
});

test("direct API catalog describes guarded methods", () => {
  expect(apiMethods().some(method => method.method === "conversations.history" && method.mode === "read")).toBe(true);
  expect(apiDescribe("chat.postMessage")?.mode).toBe("write");
  expect(apiDescribe("reactions.add")?.example).toEqual({ channel: "C123", timestamp: "1710000000.000001", name: "white_check_mark" });
});
