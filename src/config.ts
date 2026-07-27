import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type Credentials = {
  workspaceUrl: string;
  xoxc: string;
  xoxd: string;
  updatedAt: string;
};

type CredentialStore = {
  version: 1;
  activeProfile?: string;
  profiles: Record<string, Credentials>;
};

function requestedProfile(): string | undefined {
  const args = process.argv.slice(2);
  const inline = args.find(arg => arg.startsWith("--profile="));
  if (inline) return inline.slice("--profile=".length);
  const index = args.indexOf("--profile");
  return index >= 0 ? args[index + 1] : undefined;
}

export function configDir(): string {
  if (process.platform === "darwin") return join(homedir(), "Library", "Application Support", "slack-cli");
  if (process.platform === "win32") return join(process.env.APPDATA || join(homedir(), "AppData", "Roaming"), "slack-cli");
  return join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "slack-cli");
}

export function cacheDir(): string {
  if (process.platform === "darwin") return join(homedir(), "Library", "Caches", "slack-cli");
  if (process.platform === "win32") return join(process.env.LOCALAPPDATA || process.env.APPDATA || join(homedir(), "AppData", "Local"), "slack-cli", "Cache");
  return join(process.env.XDG_CACHE_HOME || join(homedir(), ".cache"), "slack-cli");
}

export function credentialsPath(): string {
  return join(configDir(), "credentials.json");
}

export async function readCredentialStore(): Promise<CredentialStore> {
  try {
    const parsed = JSON.parse(await readFile(credentialsPath(), "utf8"));
    if (parsed?.version === 1 && parsed?.profiles && typeof parsed.profiles === "object") return parsed;
  } catch { /* First run or invalid file. */ }
  return { version: 1, profiles: {} };
}

async function atomicWrite(path: string, content: string, mode: number): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(temp, content, { mode });
    await chmod(temp, mode).catch(() => {});
    await rename(temp, path);
    await chmod(path, mode).catch(() => {});
  } finally {
    await rm(temp, { force: true }).catch(() => {});
  }
}

export async function saveCredentials(profile: string, credentials: Omit<Credentials, "updatedAt">): Promise<void> {
  const store = await readCredentialStore();
  store.profiles[profile] = { ...credentials, updatedAt: new Date().toISOString() };
  store.activeProfile = profile;
  await atomicWrite(credentialsPath(), `${JSON.stringify(store, null, 2)}\n`, 0o600);
}

export async function removeCredentials(profile?: string): Promise<boolean> {
  const store = await readCredentialStore();
  const selected = profile || store.activeProfile;
  if (!selected || !store.profiles[selected]) return false;
  delete store.profiles[selected];
  if (store.activeProfile === selected) store.activeProfile = Object.keys(store.profiles)[0];
  await atomicWrite(credentialsPath(), `${JSON.stringify(store, null, 2)}\n`, 0o600);
  return true;
}

export async function loadCredentials(): Promise<{ credentials: Credentials; profile?: string; source: "environment" | "store" }> {
  const store = await readCredentialStore();
  const profile = requestedProfile() || store.activeProfile;
  const stored = profile ? store.profiles[profile] : undefined;
  const envXoxc = process.env.SLACK_XOXC_TOKEN;
  const envXoxd = process.env.SLACK_XOXD_TOKEN;
  const envWorkspace = process.env.SLACK_WORKSPACE_URL;

  if (envXoxc && envXoxd) {
    return {
      credentials: {
        workspaceUrl: envWorkspace || stored?.workspaceUrl || "https://gogeoh.slack.com",
        xoxc: envXoxc,
        xoxd: decodeXoxd(envXoxd),
        updatedAt: "",
      },
      profile,
      source: "environment",
    };
  }
  if (stored) return { credentials: { ...stored, xoxd: decodeXoxd(stored.xoxd) }, profile, source: "store" };
  throw new Error("Slack credentials are not configured. Run: slack-cli auth");
}

export function decodeXoxd(value: string): string {
  try { return decodeURIComponent(value); } catch { return value; }
}
