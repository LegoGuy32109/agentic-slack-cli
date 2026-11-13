// Slack's external upload flow, kept out of client.ts on purpose.
//
// client.ts means "call Slack's API with our credentials." Step 2 of this flow
// is neither: it POSTs bytes to a pre-signed URL that takes no token and no
// cookie. Keeping it here means exactly one function in this codebase sends a
// file body to a host outside the Slack API, it asserts the origin first, and it
// provably never attaches the `d` cookie.
//
// Legacy files.upload is retired. The flow is three steps:
//   1. files.getUploadURLExternal  -> upload_url + file_id
//   2. POST the bytes to upload_url
//   3. files.completeUploadExternal -> shares the file and posts the message
//
// Step 1 creates a file object before any bytes exist, so any failure after it
// leaves an orphan. Every failure path here deletes what it reserved. This is
// also why a dry run must never reach step 1.

import { basename } from "node:path";

export type UploadDeps = {
  call: (method: string, params: Record<string, unknown>) => Promise<any>;
  put: (url: string, path: string, filename: string) => Promise<void>;
};

export type FileDescription = {
  path: string;
  name: string;
  title: string;
  size: number;
  sha256?: string;
  preview?: string;
};

export type UploadedFile = { id: string; name: string; size: number; permalink?: string };

export type UploadResult = {
  files: UploadedFile[];
  ts?: string;
  orphans: string[];
};

// Slack's per-file ceiling. Checked here because step 1 does NOT enforce it:
// confirmed live that files.getUploadURLExternal happily reserved an id for a
// 1.5 GB file, which means the rejection would land after transferring 1.5 GB.
// Fail on the local stat instead.
export const MAX_UPLOAD_BYTES = 1024 * 1024 * 1024;
const PREVIEW_TEXT_MAX = 1024 * 1024;
const PREVIEW_SNIFF_BYTES = 4096;

export function assertUploadSize(size: number, path: string): void {
  if (size === 0) throw new Error(`File is empty, Slack rejects a zero-length upload: ${path}`);
  if (size > MAX_UPLOAD_BYTES) {
    throw new Error(`File is ${(size / 1024 / 1024 / 1024).toFixed(2)} GB, above Slack's 1 GB per-file limit: ${path}. Slack reserves an upload id for an oversized file anyway and rejects the bytes only after the transfer, so this stops here instead.`);
  }
}

// Hashing is not the bottleneck. Measured 707 MB/s on a 10 MB PDF and 1165 MB/s
// on a 57 MB video, against an upload path that moves 0.3 to 0.6 MB/s, so even a
// file at the 1 GB ceiling hashes in about a second. Every file gets a preview
// hash.
export async function hashFile(path: string): Promise<string> {
  const hasher = new Bun.CryptoHasher("sha256");
  const stream = Bun.file(path).stream();
  for await (const chunk of stream as unknown as AsyncIterable<Uint8Array>) hasher.update(chunk);
  return hasher.digest("hex");
}

// The preview exists so an agent about to publish the wrong document is visible
// before the bytes leave the machine, not after.
export async function describeFile(path: string, title?: string): Promise<FileDescription> {
  const file = Bun.file(path);
  if (!(await file.exists())) throw new Error(`File not found: ${path}`);
  const size = file.size;
  assertUploadSize(size, path);
  const name = basename(path);
  const description: FileDescription = { path, name, title: title || name, size };
  description.sha256 = await hashFile(path);
  if (size <= PREVIEW_TEXT_MAX) {
    const head = new Uint8Array(await file.slice(0, PREVIEW_SNIFF_BYTES).arrayBuffer());
    if (!head.includes(0)) {
      const text = new TextDecoder().decode(head).split("\n")[0] ?? "";
      if (text.trim()) description.preview = text.slice(0, 120);
    }
  }
  return description;
}

export async function describeFiles(paths: string[], titles: string[] = []): Promise<FileDescription[]> {
  const described: FileDescription[] = [];
  for (const [index, path] of paths.entries()) described.push(await describeFile(path, titles[index]));
  return described;
}

// Step 1 hands back a URL on Slack's own infrastructure. Assert that before
// streaming a file to it, so a change upstream fails loudly instead of quietly
// shipping a customer document to a new host.
export function assertUploadOrigin(url: string): URL {
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new Error("Slack returned an unparseable upload URL."); }
  if (parsed.protocol !== "https:") throw new Error(`Refusing a non-HTTPS upload URL (${parsed.protocol}).`);
  if (parsed.hostname !== "slack.com" && !parsed.hostname.endsWith(".slack.com")) {
    throw new Error(`Refusing to upload to an unexpected host: ${parsed.hostname}. Verify this change before allowing it.`);
  }
  return parsed;
}

// Streamed, not buffered. Bun.file is a Blob, so FormData sends it without
// reading the whole file into memory, which matters at video sizes.
export async function putUploadBytes(url: string, path: string, filename: string): Promise<void> {
  assertUploadOrigin(url);
  const body = new FormData();
  body.set("file", Bun.file(path), filename);
  const response = await fetch(url, { method: "POST", body });
  if (!response.ok) throw new Error(`Upload failed with HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
}

function shareTimestamp(file: any, channelId: string): string | undefined {
  const shares = file?.shares ?? {};
  for (const scope of ["public", "private"]) {
    const entry = shares?.[scope]?.[channelId];
    if (Array.isArray(entry) && entry[0]?.ts) return entry[0].ts as string;
  }
  return undefined;
}

// Per-file reserve-and-upload is independent work, so it runs concurrently.
//
// Measured both ways against the same files. Six small PDFs (0.5 MB total) took
// 7.92 s sequentially and 2.94 s with four lanes, because per-file round trips
// dominate. Four 2.5 MB PDFs took 27.0 s sequentially and 28.9 s with four
// lanes, which is noise: at that size the uplink is already saturated, so
// parallelism neither helps nor hurts. Four lanes is therefore a large win for
// batches of small files and free otherwise.
export const UPLOAD_CONCURRENCY = 4;

export async function uploadFiles(
  deps: UploadDeps,
  options: { channelId: string; comment?: string; threadTs?: string; files: FileDescription[]; concurrency?: number },
): Promise<UploadResult> {
  const reserved: ({ id: string; description: FileDescription } | undefined)[] = new Array(options.files.length);
  const orphans: string[] = [];

  const cleanup = async () => {
    for (const item of reserved) {
      if (!item) continue;
      try { await deps.call("files.delete", { file: item.id }); }
      catch { orphans.push(item.id); }
    }
  };

  try {
    let next = 0;
    const worker = async () => {
      while (true) {
        const index = next++;
        const description = options.files[index];
        if (!description) return;
        const reservation = await deps.call("files.getUploadURLExternal", { filename: description.name, length: description.size });
        if (!reservation?.upload_url || !reservation?.file_id) throw new Error("Slack did not return an upload URL and file id.");
        // Recorded before the bytes go out, so cleanup can find it either way.
        reserved[index] = { id: reservation.file_id as string, description };
        await deps.put(reservation.upload_url as string, description.path, description.name);
      }
    };
    const lanes = Math.max(1, Math.min(options.concurrency ?? UPLOAD_CONCURRENCY, options.files.length));
    // allSettled, not Promise.all: a rejection must not start cleanup while
    // another lane is still uploading into a reservation cleanup would miss.
    const settled = await Promise.allSettled(Array.from({ length: lanes }, worker));
    const failed = settled.find(result => result.status === "rejected");
    if (failed) throw (failed as PromiseRejectedResult).reason;

    const completion = await deps.call("files.completeUploadExternal", {
      files: reserved.map(item => ({ id: item!.id, title: item!.description.title })),
      channel_id: options.channelId,
      ...(options.comment ? { initial_comment: options.comment } : {}),
      ...(options.threadTs ? { thread_ts: options.threadTs } : {}),
    });

    const returned: any[] = completion?.files ?? [];
    const files: UploadedFile[] = reserved.map((item, index) => ({
      id: item!.id,
      name: item!.description.name,
      size: item!.description.size,
      permalink: returned[index]?.permalink,
    }));
    return { files, ts: returned.map(file => shareTimestamp(file, options.channelId)).find(Boolean), orphans: [] };
  } catch (error) {
    await cleanup();
    const detail = orphans.length ? ` Orphaned file ids left in the workspace: ${orphans.join(", ")}. Delete them with \`slack-cli api files.delete\`.` : " Reserved file ids were deleted.";
    throw new Error(`${error instanceof Error ? error.message : String(error)}${detail}`);
  }
}

// Share metadata lags the completion call. Confirmed live: a file posted to a DM
// reported `shares: {}` when read immediately, and the full share record moments
// later, with the message itself already visible in the channel the whole time.
// So a single read is a false negative, not a failed upload. Poll with backoff.
export async function resolveShare(
  deps: Pick<UploadDeps, "call">,
  channelId: string,
  fileId: string,
  attempts = 6,
  sleep: (ms: number) => Promise<unknown> = Bun.sleep,
): Promise<{ ts?: string; size?: number }> {
  let size: number | undefined;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const info = await deps.call("files.info", { file: fileId });
    size = info?.file?.size as number | undefined;
    const ts = shareTimestamp(info?.file, channelId);
    if (ts) return { ts, size };
    if (attempt < attempts - 1) await sleep(250 * 2 ** attempt);
  }
  return { ts: undefined, size };
}

// The upload is three network hops and step 2 can return a success status on a
// short body, so verification re-reads from Slack rather than trusting the
// completion response, which reports mimetype and filetype empty until Slack
// sniffs the content.
//
// The posted message is the authority, not the file's own share record. Measured
// live: a 57 MB upload was visible as a message immediately while files.info
// still reported `shares: {}` seconds later. So resolve the timestamp once, then
// read that one message and confirm every file id landed on it with the right
// size. One authoritative read beats polling each file.
export async function verifyUpload(
  deps: Pick<UploadDeps, "call">,
  channelId: string,
  files: UploadedFile[],
  sleep?: (ms: number) => Promise<unknown>,
  knownTs?: string,
  threadTs?: string,
): Promise<{ ok: boolean; ts?: string; checks: { id: string; name: string; expected: number; actual?: number; shared: boolean; ok: boolean; reason?: string }[] }> {
  const ts = knownTs ?? (await resolveShare(deps, channelId, files[0]!.id, 6, sleep)).ts;

  // A threaded reply is not in channel history, so read the thread instead.
  // Confirmed live: a file posted with thread_ts returned no message from
  // conversations.history and verified correctly through conversations.replies.
  let posted: Map<string, number | undefined> | undefined;
  if (ts) {
    const response = threadTs
      ? await deps.call("conversations.replies", { channel: channelId, ts: threadTs, limit: 200 })
      : await deps.call("conversations.history", { channel: channelId, latest: ts, oldest: ts, inclusive: true, limit: 1 });
    const message = (response?.messages ?? []).find((entry: any) => entry?.ts === ts) ?? (threadTs ? undefined : response?.messages?.[0]);
    if (message) posted = new Map((message.files ?? []).map((file: any) => [file.id, file.size]));
  }

  const checks = [];
  for (const file of files) {
    if (posted) {
      const actual = posted.get(file.id);
      const shared = posted.has(file.id);
      checks.push({ id: file.id, name: file.name, expected: file.size, actual, shared, ok: shared && actual === file.size });
      continue;
    }
    // The message could not be read back. Report the file's own record and say
    // plainly that this is unverified, rather than implying a failed upload.
    const share = await resolveShare(deps, channelId, file.id, 1, sleep);
    checks.push({ id: file.id, name: file.name, expected: file.size, actual: share.size, shared: !!share.ts, ok: false, reason: "could not read the posted message back" });
  }
  return { ok: checks.every(check => check.ok), ts, checks };
}
