import { join } from "node:path";

const CONFIG_PATH = join(import.meta.dir, "../../.env");

export async function auth(curlInput: string) {
  // Extract xoxc from multipart body: name="token"\r\n\r\n<value>
  const xoxcMatch = curlInput.match(/name="token"\\r\\n\\r\\n(xoxc-[^\s\\]+)/);
  // Extract xoxd from cookie string: d=<urlencoded_value>
  const xoxdMatch = curlInput.match(/[;' ]d=(xoxd-[^;'"\\\s]+)/);
  // Extract workspace URL from the curl target URL
  const urlMatch = curlInput.match(/curl\s+'(https:\/\/[^/]+)/);

  if (!xoxcMatch) {
    console.error("Could not find xoxc token in curl command (expected name=\"token\" in --data-raw)");
    process.exit(1);
  }
  if (!xoxdMatch) {
    console.error("Could not find xoxd token in curl command (expected d= in -b cookie string)");
    process.exit(1);
  }

  const xoxc = xoxcMatch[1];
  const xoxdRaw = xoxdMatch[1];
  // xoxd may be URL-encoded in the cookie string
  const xoxd = decodeURIComponent(xoxdRaw);
  const workspaceUrl = urlMatch ? urlMatch[1] : null;

  // Read existing .env to preserve other vars
  let existing = "";
  try {
    existing = await Bun.file(CONFIG_PATH).text();
  } catch { /* no existing file */ }

  const set = (content: string, key: string, value: string) => {
    const line = `${key}=${value}`;
    const re = new RegExp(`^${key}=.*$`, "m");
    return re.test(content) ? content.replace(re, line) : content + (content.endsWith("\n") ? "" : "\n") + line + "\n";
  };

  let updated = existing;
  updated = set(updated, "SLACK_XOXC_TOKEN", xoxc);
  updated = set(updated, "SLACK_XOXD_TOKEN", xoxd);
  if (workspaceUrl) updated = set(updated, "SLACK_WORKSPACE_URL", workspaceUrl);

  await Bun.write(CONFIG_PATH, updated);

  console.log(`Tokens saved to .env`);
  if (workspaceUrl) console.log(`  workspace: ${workspaceUrl}`);
  console.log(`  xoxc: ${xoxc.slice(0, 20)}...`);
  console.log(`  xoxd: ${xoxd.slice(0, 20)}...`);

  // Verify the tokens work
  try {
    const { call } = await import("../client.ts");
    const res = await call("auth.test");
    console.log(`\nAuth OK — ${res.user} @ ${res.team}`);
  } catch (e: any) {
    console.error(`\nWarning: token verification failed — ${e.message}`);
  }
}
