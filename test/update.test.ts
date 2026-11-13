import { expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { update, updateInternals } from "../src/commands/update.ts";
import { VERSION } from "../src/version.ts";

// Exercise replacement on a disposable executable. No GitHub calls or stored
// credentials are used, and process state is restored after every case.
async function withRelease(
  options: { badChecksum?: boolean; missingAsset?: boolean },
  run: (target: string, requests: string[], logs: string[]) => Promise<void>,
) {
  const folder = await mkdtemp(join(tmpdir(), "slack-cli-update-test-"));
  const target = join(folder, process.platform === "win32" ? "slack-cli.exe" : "slack-cli");
  const originalFetch = globalThis.fetch;
  const originalExecutable = process.execPath;
  const originalLog = console.log;
  const requests: string[] = [];
  const logs: string[] = [];
  const binary = new TextEncoder().encode("verified replacement binary");
  const hash = options.badChecksum ? "0".repeat(64) : createHash("sha256").update(binary).digest("hex");
  const asset = updateInternals.targetAsset();
  await writeFile(target, "original binary");
  process.execPath = target;
  console.log = (...parts: unknown[]) => logs.push(parts.join(" "));
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    requests.push(url);
    if (url.endsWith("/releases/latest")) return Response.json({
      tag_name: "v9999.0.0",
      assets: [
        ...options.missingAsset ? [] : [{ name: asset, browser_download_url: "https://example.invalid/binary" }],
        { name: "SHA256SUMS", browser_download_url: "https://example.invalid/sums" },
      ],
    });
    if (url === "https://example.invalid/binary") return new Response(binary);
    if (url === "https://example.invalid/sums") return new Response(`${hash}  ${asset}\n`);
    throw new Error(`Unexpected request in update test: ${url}`);
  }) as typeof fetch;
  try { await run(target, requests, logs); }
  finally {
    globalThis.fetch = originalFetch;
    process.execPath = originalExecutable;
    console.log = originalLog;
    await rm(folder, { recursive: true, force: true });
  }
}

test("update --check reports an available release without downloading or replacing", async () => {
  await withRelease({}, async (target, requests, logs) => {
    await update({ check: true, force: false });
    expect(JSON.parse(logs[0]!)).toEqual({ current: VERSION, latest: "v9999.0.0", updateAvailable: true });
    expect(requests).toHaveLength(1);
    expect(await readFile(target, "utf8")).toBe("original binary");
  });
});

test("update rejects a checksum mismatch and keeps the installed executable", async () => {
  await withRelease({ badChecksum: true }, async target => {
    await expect(update({ check: false, force: false })).rejects.toThrow(/checksum did not match/);
    expect(await readFile(target, "utf8")).toBe("original binary");
    expect(await readdir(join(target, ".."))).toEqual([target.split(/[\\/]/).at(-1)!]);
  });
});

test("update refuses a release missing the platform asset", async () => {
  await withRelease({ missingAsset: true }, async (target, requests) => {
    await expect(update({ check: false, force: false })).rejects.toThrow(/missing/);
    expect(requests).toHaveLength(1);
    expect(await readFile(target, "utf8")).toBe("original binary");
  });
});

// Windows replacement launches cmd.exe after exit, so verify that platform's
// delayed replacement through release smoke testing instead of this fixture.
test.skipIf(process.platform === "win32")("update replaces a disposable executable only after checksum verification", async () => {
  await withRelease({}, async target => {
    await update({ check: false, force: false });
    expect(await readFile(target, "utf8")).toBe("verified replacement binary");
    expect(await readdir(join(target, ".."))).toEqual([target.split(/[\\/]/).at(-1)!]);
  });
});
