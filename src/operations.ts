import { readFile } from "node:fs/promises";
import { resolveChannel } from "./references.ts";

const channelMethods = new Set([
  "conversations.info", "conversations.history", "conversations.replies", "conversations.members",
  "conversations.mark", "chat.postMessage", "chat.delete", "reactions.add",
]);

export async function jsonValueInput(value: string, flag: string): Promise<unknown> {
  const source = value.startsWith("@") ? await readFile(value.slice(1), "utf8") : value;
  try { return JSON.parse(source); } catch { throw new Error(`${flag} must be valid JSON${value.startsWith("@") ? ` (${value.slice(1)})` : ""}.`); }
}

export async function jsonInput(value: string | undefined, flag = "--params"): Promise<Record<string, unknown>> {
  if (!value) return {};
  const parsed = await jsonValueInput(value, flag);
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") throw new Error(`${flag} must be a JSON object.`);
  return parsed as Record<string, unknown>;
}

export async function prepareOperation(method: string, original: Record<string, unknown>): Promise<Record<string, unknown>> {
  const params = { ...original };
  if (channelMethods.has(method) && typeof params.channel === "string") params.channel = (await resolveChannel(params.channel)).id;
  return params;
}

export function wireParams(params: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => [key, typeof value === "string" ? value : typeof value === "object" ? JSON.stringify(value) : String(value)]));
}
