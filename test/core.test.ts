import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { apiDescribe, apiMethods } from "../src/commands/api.ts";
import { decodeXoxd } from "../src/config.ts";
import { mentionIds, renderMentions } from "../src/client.ts";
import { resolveCachedIdentity, resolveCachedUsers } from "../src/user-cache.ts";
import { normalizeMessage } from "../src/message.ts";
import { markInternals } from "../src/commands/mark.ts";
import { updateInternals } from "../src/commands/update.ts";

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

  test("normalizes attachment-backed prompts without duplicating rich text", () => {
    expect(normalizeMessage({
      ts: "1", user: "U1", text: "Hello world",
      blocks: [{ elements: [{ type: "rich_text_section", elements: [{ type: "text", text: "Hello world" }] }] }],
      attachments: [{ fallback: "What plan do today?", fields: [{ title: "What plan do today?", value: "" }] }],
    })).toMatchObject({ text: "Hello world", content: "Hello world\nWhat plan do today?" });
  });

  test("caches authenticated identity timezone", async () => {
    const dir = await mkdtemp(join(tmpdir(), "slack-cli-test-"));
    temporaryDirs.push(dir);
    process.env.XDG_CACHE_HOME = dir;
    let lookups = 0;
    const lookup = async () => { lookups++; return { username: "ada", timezone: "America/Indiana/Indianapolis" }; };
    expect((await resolveCachedIdentity("https://example.slack.com", "U1", lookup))?.timezone).toBe("America/Indiana/Indianapolis");
    expect((await resolveCachedIdentity("https://example.slack.com", "U1", lookup))?.username).toBe("ada");
    expect(lookups).toBe(1);
  });
});

test("direct API catalog describes guarded methods", () => {
  expect(apiMethods().some(method => method.method === "conversations.history" && method.mode === "read")).toBe(true);
  expect(apiDescribe("chat.postMessage")?.mode).toBe("write");
  expect(apiDescribe("reactions.add")?.example).toEqual({ channel: "C123", timestamp: "1710000000.000001", name: "white_check_mark" });
});

test("update helpers compare versions and parse checksums", () => {
  expect(updateInternals.compareVersions("v0.3.1", "0.3.0")).toBe(1);
  expect(updateInternals.compareVersions("v0.3.0", "0.3.0")).toBe(0);
  expect(updateInternals.expectedChecksum(`${"a".repeat(64)}  slack-cli-linux-x64\n`, "slack-cli-linux-x64")).toBe("a".repeat(64));
});

test("mark timestamps default to command-start time and reject invalid input", () => {
  expect(markInternals.markTimestamp(undefined, 1710000000123)).toBe("1710000000.123000");
  expect(markInternals.markTimestamp("1710000000.000001")).toBe("1710000000.000001");
  expect(() => markInternals.markTimestamp("t890234")).toThrow("Invalid timestamp");
});
