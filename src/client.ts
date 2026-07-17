const WORKSPACE_URL = process.env.SLACK_WORKSPACE_URL ?? "https://gogeoh.slack.com";

const xoxc = process.env.SLACK_XOXC_TOKEN;
const xoxd = process.env.SLACK_XOXD_TOKEN;

if ((!xoxc || !xoxd) && process.argv[2] !== "auth") {
  console.error("Error: SLACK_XOXC_TOKEN and SLACK_XOXD_TOKEN must be set.\nRun: slack auth <paste curl command>");
  process.exit(1);
}

export async function call(method: string, params: Record<string, string | number | boolean> = {}): Promise<any> {
  const body = new URLSearchParams({
    token: xoxc, ...Object.fromEntries(
      Object.entries(params).map(([k, v]) => [k, String(v)])
    )
  } as Record<string, string>);

  if (!xoxd) throw new Error('No -xoxd token present')

  const res = await fetch(`${WORKSPACE_URL}/api/${method}`, {
    method: "POST",
    headers: {
      "Cookie": `d=${encodeURIComponent(xoxd)}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Origin": "https://app.slack.com",
      "User-Agent": "Mozilla/5.0 (compatible)",
    },
    body,
  });

  const data = await res.json() as any;
  if (!data.ok) throw new Error(`${method} failed: ${data.error}`);
  return data;
}

// Resolve a batch of user IDs to display names
export async function resolveUsers(ids: string[]): Promise<Record<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))];
  const map: Record<string, string> = {};
  await Promise.all(unique.map(async (id) => {
    try {
      const d = await call("users.info", { user: id });
      map[id] = d.user.profile.display_name || d.user.real_name || d.user.name;
    } catch {
      map[id] = id;
    }
  }));
  return map;
}
