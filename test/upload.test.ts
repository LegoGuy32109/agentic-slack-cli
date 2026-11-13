import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertUploadOrigin, assertUploadSize, MAX_UPLOAD_BYTES, describeFile, describeFiles, resolveShare, uploadFiles, verifyUpload, type UploadDeps } from "../src/upload.ts";
import { apiDescribe, apiMethods } from "../src/commands/api.ts";
import { missingRequired, methodInfo } from "../src/methods.ts";
import { send } from "../src/commands/send.ts";

const temporaryDirs: string[] = [];
afterEach(async () => {
  await Promise.all(temporaryDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

async function fixture(name: string, content: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "slack-cli-upload-"));
  temporaryDirs.push(dir);
  const path = join(dir, name);
  await writeFile(path, content);
  return path;
}

function recordingDeps(overrides: Partial<UploadDeps> = {}) {
  const calls: { method: string; params: Record<string, unknown> }[] = [];
  const puts: string[] = [];
  const deps: UploadDeps = {
    call: async (method, params) => {
      calls.push({ method, params });
      if (method === "files.getUploadURLExternal") return { ok: true, upload_url: "https://files.slack.com/upload/v1/abc", file_id: `F${calls.length}` };
      if (method === "files.completeUploadExternal") {
        return { ok: true, files: [{ id: "F1", permalink: "https://example.slack.com/files/F1", shares: { private: { C1: [{ ts: "1786729708.1" }] } } }] };
      }
      if (method === "files.info") return { ok: true, file: { size: 5, shares: { private: { C1: [{ ts: "1786729708.1" }] } } } };
      return { ok: true };
    },
    put: async url => { puts.push(url); },
    ...overrides,
  };
  return { deps, calls, puts };
}

describe("file description and preview", () => {
  test("hashes a small file and reports its first line", async () => {
    const path = await fixture("notes.md", "# Title\nbody\n");
    const described = await describeFile(path);
    expect(described.name).toBe("notes.md");
    expect(described.size).toBe(13);
    expect(described.sha256).toHaveLength(64);
    expect(described.preview).toBe("# Title");
  });

  test("refuses an empty file, because Slack rejects a zero length upload", async () => {
    const path = await fixture("empty.md", "");
    await expect(describeFile(path)).rejects.toThrow(/empty/);
  });

  test("refuses a missing file before any network call", async () => {
    await expect(describeFile("/nonexistent/nope.md")).rejects.toThrow(/not found/i);
  });

  test("applies titles positionally and defaults to the file name", async () => {
    const first = await fixture("a.md", "a\n");
    const second = await fixture("b.md", "b\n");
    const described = await describeFiles([first, second], ["Custom"]);
    expect(described.map(file => file.title)).toEqual(["Custom", "b.md"]);
  });
});

describe("upload origin", () => {
  test("accepts a Slack host", () => {
    expect(assertUploadOrigin("https://files.slack.com/upload/v1/abc").hostname).toBe("files.slack.com");
  });

  test("refuses a foreign host, so an upstream change fails loudly", () => {
    expect(() => assertUploadOrigin("https://evil.example.com/upload")).toThrow(/unexpected host/);
  });

  test("refuses plain http", () => {
    expect(() => assertUploadOrigin("http://files.slack.com/upload")).toThrow(/non-HTTPS/);
  });
});

describe("upload flow", () => {
  test("runs the three steps in order and returns a receipt", async () => {
    const path = await fixture("notes.md", "hello");
    const { deps, calls, puts } = recordingDeps();
    const result = await uploadFiles(deps, { channelId: "C1", comment: "here", files: await describeFiles([path]) });
    expect(calls.map(entry => entry.method)).toEqual(["files.getUploadURLExternal", "files.completeUploadExternal"]);
    expect(puts).toEqual(["https://files.slack.com/upload/v1/abc"]);
    expect(result.files[0]).toMatchObject({ id: "F1", name: "notes.md", size: 5 });
    expect(result.ts).toBe("1786729708.1");
  });

  test("passes the initial comment and thread through to completion", async () => {
    const path = await fixture("notes.md", "hello");
    const { deps, calls } = recordingDeps();
    await uploadFiles(deps, { channelId: "C1", comment: "text here", threadTs: "1.2", files: await describeFiles([path]) });
    const completion = calls.find(entry => entry.method === "files.completeUploadExternal")!;
    expect(completion.params.initial_comment).toBe("text here");
    expect(completion.params.thread_ts).toBe("1.2");
    expect(completion.params.channel_id).toBe("C1");
  });

  test("deletes the reserved file when the byte upload fails, leaving no orphan", async () => {
    const path = await fixture("notes.md", "hello");
    const { deps, calls } = recordingDeps({ put: async () => { throw new Error("connection reset"); } });
    await expect(uploadFiles(deps, { channelId: "C1", files: await describeFiles([path]) })).rejects.toThrow(/connection reset/);
    await Bun.sleep(1);
    expect(calls.map(entry => entry.method)).toContain("files.delete");
  });

  test("reports orphan ids when cleanup itself fails", async () => {
    const path = await fixture("notes.md", "hello");
    const { deps } = recordingDeps({
      call: async (method: string) => {
        if (method === "files.getUploadURLExternal") return { ok: true, upload_url: "https://files.slack.com/upload/v1/abc", file_id: "F9" };
        if (method === "files.completeUploadExternal") throw new Error("complete failed");
        throw new Error("delete failed");
      },
    });
    await expect(uploadFiles(deps, { channelId: "C1", files: await describeFiles([path]) })).rejects.toThrow(/F9/);
  });
});

describe("share resolution", () => {
  test("retries until the share record appears, because Slack populates it late", async () => {
    let reads = 0;
    const slept: number[] = [];
    const deps = {
      call: async () => {
        reads++;
        return { ok: true, file: { size: 5, shares: reads < 3 ? {} : { private: { C1: [{ ts: "1.1" }] } } } };
      },
    };
    const share = await resolveShare(deps, "C1", "F1", 6, async ms => { slept.push(ms); });
    expect(share.ts).toBe("1.1");
    expect(reads).toBe(3);
    expect(slept).toEqual([250, 500]);
  });

  test("gives up after the attempt budget instead of polling forever", async () => {
    let reads = 0;
    const deps = { call: async () => { reads++; return { ok: true, file: { size: 5, shares: {} } }; } };
    const share = await resolveShare(deps, "C1", "F1", 6, async () => {});
    expect(share.ts).toBeUndefined();
    expect(reads).toBe(6);
  });
});

// Verification reads the posted message, not each file's own share record. A
// 57 MB upload was visible as a message while files.info still reported no
// shares, so the message is the authority.
function messageDeps(files: { id: string; size: number }[], ts = "1.1") {
  const calls: string[] = [];
  return {
    calls,
    deps: {
      call: async (method: string) => {
        calls.push(method);
        if (method === "files.info") return { ok: true, file: { size: files[0]?.size, shares: { private: { C1: [{ ts }] } } } };
        if (method === "conversations.history") return { ok: true, messages: [{ ts, files }] };
        return { ok: true };
      },
    },
  };
}

describe("verification", () => {
  test("confirms every file landed on the posted message with the right size", async () => {
    const { deps, calls } = messageDeps([{ id: "F1", size: 5 }, { id: "F2", size: 9 }]);
    const result = await verifyUpload(deps, "C1", [{ id: "F1", name: "a.md", size: 5 }, { id: "F2", name: "b.md", size: 9 }], async () => {});
    expect(result.ok).toBe(true);
    expect(result.ts).toBe("1.1");
    expect(calls.filter(method => method === "conversations.history")).toHaveLength(1);
  });

  test("reuses a known timestamp instead of polling for it again", async () => {
    const { deps, calls } = messageDeps([{ id: "F1", size: 5 }]);
    const result = await verifyUpload(deps, "C1", [{ id: "F1", name: "a.md", size: 5 }], async () => {}, "1.1");
    expect(result.ok).toBe(true);
    expect(calls).toEqual(["conversations.history"]);
  });

  test("fails when the message reports a different size, which is how a short body shows up", async () => {
    const { deps } = messageDeps([{ id: "F1", size: 3 }]);
    const result = await verifyUpload(deps, "C1", [{ id: "F1", name: "a.md", size: 5 }], async () => {}, "1.1");
    expect(result.ok).toBe(false);
    expect(result.checks[0]).toMatchObject({ expected: 5, actual: 3 });
  });

  test("fails when a file never landed on the message", async () => {
    const { deps } = messageDeps([{ id: "F1", size: 5 }]);
    const result = await verifyUpload(deps, "C1", [{ id: "F1", name: "a.md", size: 5 }, { id: "F2", name: "b.md", size: 9 }], async () => {}, "1.1");
    expect(result.ok).toBe(false);
    expect(result.checks[1]).toMatchObject({ id: "F2", shared: false });
  });

  test("fails when no timestamp ever resolves, rather than reporting success", async () => {
    const deps = { call: async () => ({ ok: true, file: { size: 5, shares: {} } }) };
    const result = await verifyUpload(deps, "C1", [{ id: "F1", name: "a.md", size: 5 }], async () => {});
    expect(result.ok).toBe(false);
    expect(result.ts).toBeUndefined();
  });
});

describe("send guards", () => {
  test("rejects blocks alongside a file, because an initial comment takes no blocks", async () => {
    const path = await fixture("notes.md", "hello");
    await expect(send("C1", "text", { allowWrite: false, json: false, files: [path], blocks: "[]" })).rejects.toThrow(/--blocks/);
  });

  test("rejects rich format alongside a file", async () => {
    const path = await fixture("notes.md", "hello");
    await expect(send("C1", "text", { allowWrite: false, json: false, files: [path], format: "rich" })).rejects.toThrow(/--format rich/);
  });
});

describe("method catalogue", () => {
  test("publishes the file methods with their effect class", () => {
    const entries = Object.fromEntries(apiMethods().map(entry => [entry.method, entry]));
    expect(entries["files.completeUploadExternal"]).toMatchObject({ mode: "write", effect: "file" });
    expect(entries["files.delete"]).toMatchObject({ mode: "write", effect: "file" });
    expect(entries["conversations.history"]).toMatchObject({ mode: "read", effect: "read" });
  });

  test("describes required parameters so a caller fails before the network", () => {
    expect(apiDescribe("files.delete")?.required).toEqual(["file"]);
    expect(missingRequired(methodInfo("files.delete"), {})).toEqual(["file"]);
    expect(missingRequired(methodInfo("files.delete"), { file: "F1" })).toEqual([]);
  });
});

describe("size ceiling", () => {
  test("refuses a file above Slack's per-file limit, which step 1 does not enforce", () => {
    expect(() => assertUploadSize(MAX_UPLOAD_BYTES + 1, "/tmp/big.mp4")).toThrow(/1 GB per-file limit/);
    expect(() => assertUploadSize(MAX_UPLOAD_BYTES, "/tmp/ok.mp4")).not.toThrow();
  });

  test("refuses a zero-length file", () => {
    expect(() => assertUploadSize(0, "/tmp/empty.md")).toThrow(/empty/);
  });
});

describe("threaded verification", () => {
  test("reads the thread, because a reply never appears in channel history", async () => {
    const methods: string[] = [];
    const deps = {
      call: async (method: string) => {
        methods.push(method);
        if (method === "conversations.replies") return { ok: true, messages: [{ ts: "9.0" }, { ts: "9.5", files: [{ id: "F1", size: 5 }] }] };
        if (method === "conversations.history") return { ok: true, messages: [] };
        return { ok: true, file: { size: 5, shares: {} } };
      },
    };
    const result = await verifyUpload(deps, "C1", [{ id: "F1", name: "a.md", size: 5 }], async () => {}, "9.5", "9.0");
    expect(result.ok).toBe(true);
    expect(methods).toEqual(["conversations.replies"]);
  });

  test("labels an unreadable message as unverified rather than as a failed upload", async () => {
    const deps = {
      call: async (method: string) => (method === "conversations.history"
        ? { ok: true, messages: [] }
        : { ok: true, file: { size: 5, shares: { private: { C1: [{ ts: "1.1" }] } } } }),
    };
    const result = await verifyUpload(deps, "C1", [{ id: "F1", name: "a.md", size: 5 }], async () => {}, "1.1");
    expect(result.ok).toBe(false);
    expect(result.checks[0]!.reason).toMatch(/could not read/);
  });
});

describe("upload concurrency", () => {
  test("uploads files in parallel lanes and keeps result order", async () => {
    const paths = await Promise.all(["a.md", "b.md", "c.md", "d.md"].map(name => fixture(name, name)));
    let active = 0;
    let peak = 0;
    const { deps } = recordingDeps({
      put: async () => {
        active++;
        peak = Math.max(peak, active);
        await Bun.sleep(5);
        active--;
      },
    });
    const result = await uploadFiles(deps, { channelId: "C1", files: await describeFiles(paths) });
    expect(peak).toBeGreaterThan(1);
    expect(result.files.map(file => file.name)).toEqual(["a.md", "b.md", "c.md", "d.md"]);
  });

  test("respects a concurrency of one", async () => {
    const paths = await Promise.all(["a.md", "b.md"].map(name => fixture(name, name)));
    let active = 0;
    let peak = 0;
    const { deps } = recordingDeps({
      put: async () => { active++; peak = Math.max(peak, active); await Bun.sleep(3); active--; },
    });
    await uploadFiles(deps, { channelId: "C1", concurrency: 1, files: await describeFiles(paths) });
    expect(peak).toBe(1);
  });

  test("cleans up every reservation when one lane fails mid-flight", async () => {
    const paths = await Promise.all(["a.md", "b.md", "c.md"].map(name => fixture(name, name)));
    const deleted: string[] = [];
    let puts = 0;
    const { deps } = recordingDeps({
      call: async (method: string, params: any) => {
        if (method === "files.getUploadURLExternal") return { ok: true, upload_url: "https://files.slack.com/upload/v1/abc", file_id: `F${params.filename}` };
        if (method === "files.delete") { deleted.push(params.file); return { ok: true }; }
        return { ok: true };
      },
      put: async () => {
        const order = ++puts;
        await Bun.sleep(2);
        if (order === 2) throw new Error("connection reset");
      },
    });
    await expect(uploadFiles(deps, { channelId: "C1", files: await describeFiles(paths) })).rejects.toThrow(/connection reset/);
    expect(deleted.length).toBeGreaterThanOrEqual(2);
  });
});
