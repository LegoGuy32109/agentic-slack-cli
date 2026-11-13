import { call } from "../client.ts";
import { catalogEntries, isWrite, methodInfo, missingRequired } from "../methods.ts";
import { jsonInput, prepareOperation, wireParams } from "../operations.ts";

export function apiMethods() {
  return catalogEntries();
}

export function apiDescribe(method: string) {
  const info = methodInfo(method);
  return info ? { method, mode: isWrite(info) ? "write" : "read", effect: info.effect, description: info.description, required: info.required ?? [], example: info.example } : undefined;
}

export async function api(method: string, paramsText: string | undefined, opts: { unsafe: boolean; allowWrite: boolean }) {
  if (!/^[A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z][A-Za-z0-9]*)+$/.test(method)) throw new Error("Invalid Slack API method name.");
  const params = await jsonInput(paramsText);
  const info = methodInfo(method);
  if (!info && !opts.unsafe) throw new Error(`Method ${method} is not in the read-only catalog. Use --unsafe-method after checking the Slack API reference.`);
  const missing = missingRequired(info, params);
  if (missing.length) throw new Error(`${method} requires ${missing.join(", ")}.`);
  const prepared = await prepareOperation(method, params);
  if ((isWrite(info) || !info) && !opts.allowWrite) {
    return { ok: true, dry_run: true, method, effect: info?.effect ?? "unknown", params: prepared, wire_params: wireParams(prepared) };
  }
  return call(method, prepared);
}
