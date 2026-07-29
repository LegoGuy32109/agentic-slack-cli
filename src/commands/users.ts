import { findUsers } from "../client.ts";

export async function usersFind(query: string, json: boolean) {
  const users = await findUsers(query);
  const result = users.map(user => ({ id: user.id, handle: user.username, display_name: user.displayName, real_name: user.realName, active: user.active }));
  if (json) return console.log(JSON.stringify(result, null, 2));
  if (!result.length) return console.log("No matching users.");
  for (const user of result) console.log(`${user.id}\t${user.display_name || user.real_name || user.handle || "Unknown"}${user.handle ? `\t@${user.handle}` : ""}`);
}
