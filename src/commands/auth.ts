import { credentialsPath, saveCredentials } from "../config.ts";

function tokenMatch(input: string, prefix: string): string | undefined {
  const match = input.match(new RegExp(`${prefix}-[^\\s;'"\\\\]+`));
  return match?.[0];
}

export async function auth(curlInput: string, profile = "default") {
  const xoxc = tokenMatch(curlInput, "xoxc");
  const xoxdRaw = tokenMatch(curlInput, "xoxd");
  const urlMatch = curlInput.match(/https:\/\/[^/'"\\\s]+/);
  if (!xoxc) throw new Error("Could not find an xoxc token in the pasted cURL command.");
  if (!xoxdRaw) throw new Error("Could not find an xoxd token in the pasted cURL command.");

  let xoxd = xoxdRaw;
  try { xoxd = decodeURIComponent(xoxdRaw); } catch { /* client handles raw values too */ }
  const workspaceUrl = urlMatch?.[0] || process.env.SLACK_WORKSPACE_URL || "https://gogeoh.slack.com";
  await saveCredentials(profile, { workspaceUrl, xoxc, xoxd });

  console.log(`Credentials saved for profile ${profile} at ${credentialsPath()}`);
  try {
    const { call } = await import("../client.ts");
    const res = await call("auth.test");
    console.log(`Auth OK — ${res.user} @ ${res.team}`);
  } catch (error) {
    console.error(`Warning: credentials were saved but verification failed — ${error instanceof Error ? error.message : error}`);
  }
}
