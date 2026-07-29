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
import { wireParams } from "../src/operations.ts";
import { listInternals } from "../src/commands/lists.ts";

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

test("wire parameters preserve native JSON arrays and objects", () => {
  expect(wireParams({ channel: "C1", blocks: [{ type: "section" }], metadata: { event_type: "notice" }, retry: 2 })).toEqual({
    channel: "C1", blocks: '[{"type":"section"}]', metadata: '{"event_type":"notice"}', retry: "2",
  });
});

test("List references accept IDs and canonical Slack List URLs", () => {
  expect(listInternals.listId("F0A7CDM1KKL")).toBe("F0A7CDM1KKL");
  expect(listInternals.listId("https://gogeoh.slack.com/lists/T9XTTMR28/F0A7CDM1KKL")).toBe("F0A7CDM1KKL");
  expect(listInternals.listId("https://gogeoh.slack.com/files/F0A7CDM1KKL")).toBeUndefined();
});

test("List positions use the table ordering rather than API response ordering", () => {
  expect(["1785339468", "1785339470", "1785339469", "1785339470.l", "1785339470.V"].sort(listInternals.comparePosition)).toEqual(["1785339468", "1785339469", "1785339470", "1785339470.V", "1785339470.l"]);
  expect(listInternals.positionAfter("10", "12")).toBe("11");
  expect(listInternals.positionAfter("10", "11")).toBe("10.V");
  expect(listInternals.positionAfter("10.V", "10.l")).toBe("10.d");
});

test("List payload checks verify raw writes without Slack access", () => {
  expect(listInternals.parseWhere("Name=Row=1")).toEqual({ column: "Name", value: "Row=1" });
  expect(listInternals.cellMatches({ column_id: "C1", text: "Hello" }, { row_id: "R1", column_id: "C1", rich_text: [{ elements: [{ elements: [{ text: "Hello" }] }] }] })).toBe(true);
  expect(listInternals.cellMatches({ column_id: "C1", number: [] }, { row_id: "R1", column_id: "C1", number: [] })).toBe(true);
  expect(listInternals.cellMatches({ column_id: "C1", checkbox: false }, { row_id: "R1", column_id: "C1", checkbox: false })).toBe(true);
});

test("List helpers resolve names and build typed payloads without Slack access", async () => {
  expect(listInternals.resolveListCandidate("Tracker", [{ id: "F1", title: "Tracker" }])).toEqual({ id: "F1", title: "Tracker" });
  expect(() => listInternals.resolveListCandidate("Tracker", [{ id: "F1", title: "Tracker" }, { id: "F2", title: "Tracker" }])).toThrow("ambiguous");
  const columns = [{ id: "C1", name: "Name", type: "text" }, { id: "C2", name: "Count", type: "number" }];
  expect(listInternals.selectRecords([{ id: "R1", fields: [{ column_id: "C1", text: "QA-7" }] }], columns, "Name=QA-7").matches.map((row: { id: string }) => row.id)).toEqual(["R1"]);
  expect(await listInternals.typedCell(columns[1]!, "R1", "42", false)).toEqual({ row_id: "R1", column_id: "C2", number: [42] });
  expect(await listInternals.typedCell(columns[1]!, "R1", undefined, true)).toEqual({ row_id: "R1", column_id: "C2", number: [] });
});
