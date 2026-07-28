import { createHash } from "node:crypto";
import { chmod, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { REPOSITORY, VERSION } from "../version.ts";

type ReleaseAsset = { name: string; browser_download_url: string };
type Release = { tag_name: string; assets: ReleaseAsset[] };

function compareVersions(left: string, right: string): number {
  const parse = (value: string) => value.replace(/^v/, "").split(".").map(part => Number(part.replace(/\D.*$/, "")) || 0);
  const a = parse(left); const b = parse(right);
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    if ((a[index] || 0) !== (b[index] || 0)) return (a[index] || 0) > (b[index] || 0) ? 1 : -1;
  }
  return 0;
}

function targetAsset(): string {
  if (process.platform === "linux" && process.arch === "x64") return "slack-cli-linux-x64";
  if (process.platform === "darwin" && process.arch === "arm64") return "slack-cli-mac-arm64";
  if (process.platform === "darwin" && process.arch === "x64") return "slack-cli-mac-x64";
  if (process.platform === "win32" && process.arch === "x64") return "slack-cli-windows-x64.exe";
  throw new Error(`No release asset for ${process.platform}/${process.arch}.`);
}

async function latestRelease(): Promise<Release> {
  const response = await fetch(`https://api.github.com/repos/${REPOSITORY}/releases/latest`, { headers: { Accept: "application/vnd.github+json", "User-Agent": "slack-cli" } });
  if (!response.ok) throw new Error(`Could not check for updates: GitHub returned ${response.status}.`);
  return response.json() as Promise<Release>;
}

async function download(url: string): Promise<Uint8Array> {
  const response = await fetch(url, { headers: { "User-Agent": "slack-cli" } });
  if (!response.ok) throw new Error(`Download failed: ${response.status}.`);
  return new Uint8Array(await response.arrayBuffer());
}

function expectedChecksum(contents: string, name: string): string | undefined {
  return contents.split(/\r?\n/).map(line => line.trim()).map(line => {
    const match = line.match(/^([a-fA-F0-9]{64})\s+\*?(.+)$/);
    return match ? { hash: match[1]!.toLowerCase(), file: match[2]!.trim() } : undefined;
  }).find(entry => entry?.file === name)?.hash;
}

async function replaceWindows(target: string, temporary: string) {
  const helper = join(dirname(target), `.slack-cli-update-${Date.now()}.cmd`);
  const script = `@echo off\r\ntimeout /t 1 /nobreak >nul\r\nmove /Y "${temporary}" "${target}" >nul\r\ndel "%~f0"\r\n`;
  await writeFile(helper, script, { mode: 0o700 });
  Bun.spawn(["cmd.exe", "/c", "start", "", "/b", helper], { stdio: ["ignore", "ignore", "ignore"] });
}

export async function update(opts: { check: boolean; force: boolean }) {
  const release = await latestRelease();
  const comparison = compareVersions(release.tag_name, VERSION);
  if (opts.check) {
    console.log(JSON.stringify({ current: VERSION, latest: release.tag_name, updateAvailable: comparison > 0 }, null, 2));
    return;
  }
  if (comparison === 0) return console.log(`Already up to date (${VERSION}).`);
  if (comparison < 0 && !opts.force) throw new Error(`Refusing downgrade from ${VERSION} to ${release.tag_name}; use --force to allow it.`);
  if (comparison < 0 && opts.force) console.warn(`Forcing downgrade from ${VERSION} to ${release.tag_name}.`);

  const executable = process.execPath;
  if (basename(executable).startsWith("bun")) throw new Error("Update is available only from an installed compiled slack-cli binary, not bun run.");
  const assetName = targetAsset();
  const asset = release.assets.find(candidate => candidate.name === assetName);
  const sums = release.assets.find(candidate => candidate.name === "SHA256SUMS");
  if (!asset || !sums) throw new Error(`Release ${release.tag_name} is missing ${!asset ? assetName : "SHA256SUMS"}.`);
  const [binary, checksums] = await Promise.all([download(asset.browser_download_url), download(sums.browser_download_url)]);
  const expected = expectedChecksum(new TextDecoder().decode(checksums), assetName);
  if (!expected) throw new Error(`SHA256SUMS does not contain ${assetName}.`);
  const actual = createHash("sha256").update(binary).digest("hex");
  if (actual !== expected) throw new Error("Downloaded binary checksum did not match SHA256SUMS; existing binary was not changed.");

  const temporary = `${executable}.new-${process.pid}`;
  await writeFile(temporary, binary, { mode: 0o755 });
  await chmod(temporary, 0o755).catch(() => {});
  try {
    if (process.platform === "win32") {
      await replaceWindows(executable, temporary);
      console.log(`Update to ${release.tag_name} is scheduled and will finish after slack-cli exits.`);
    } else {
      await rename(temporary, executable);
      console.log(`Updated slack-cli from ${VERSION} to ${release.tag_name}.`);
    }
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {});
    throw new Error(`Verified update could not replace ${executable}: ${error instanceof Error ? error.message : error}`);
  }
}

export const updateInternals = { compareVersions, expectedChecksum, targetAsset };
