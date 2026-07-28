import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

type Bump = "patch" | "minor" | "major";

function run(command: string[], options: { quiet?: boolean; cwd?: string } = {}): string {
  const result = Bun.spawnSync(command, { stdout: "pipe", stderr: "pipe", ...(options.cwd ? { cwd: options.cwd } : {}) });
  const stdout = new TextDecoder().decode(result.stdout).trim();
  const stderr = new TextDecoder().decode(result.stderr).trim();
  if (result.exitCode !== 0) throw new Error(`${command.join(" ")} failed.${stderr ? `\n${stderr}` : ""}`);
  if (!options.quiet && stdout) process.stdout.write(`${stdout}\n`);
  return stdout;
}

function nextVersion(version: string, bump: Bump): string {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) throw new Error(`Expected a stable MAJOR.MINOR.PATCH version, received ${version}.`);
  const [major, minor, patch] = match.slice(1).map(Number);
  if (bump === "major") return `${major! + 1}.0.0`;
  if (bump === "minor") return `${major}.${minor! + 1}.0`;
  return `${major}.${minor}.${patch! + 1}`;
}

async function main() {
  const bump = process.argv[2] as Bump | undefined;
  if (!bump || !["patch", "minor", "major"].includes(bump)) {
    throw new Error("Usage: bun run release <patch|minor|major>");
  }

  const branch = run(["git", "branch", "--show-current"], { quiet: true });
  if (!branch) throw new Error("Release must start from a named branch, not detached HEAD.");
  // Intentionally scope this guard to versioned files. Other local work is not
  // released because this script tags/commits only from the current HEAD.
  const versionFiles = ["package.json", "src/version.ts"];
  const versionDirty = Bun.spawnSync(["git", "diff", "--quiet", "HEAD", "--", ...versionFiles]).exitCode !== 0;
  if (versionDirty) throw new Error("package.json or src/version.ts has uncommitted changes. Commit or stash those version-file edits before releasing.");

  const packageJson = JSON.parse(await readFile("package.json", "utf8"));
  const current = packageJson.version;
  const next = nextVersion(current, bump);
  const source = await readFile("src/version.ts", "utf8");
  const sourceVersion = source.match(/VERSION = "([^"]+)"/)?.[1];
  if (sourceVersion !== current) throw new Error(`Version mismatch: package.json is ${current}; src/version.ts is ${sourceVersion || "missing"}.`);
  const tag = `v${next}`;
  if (Bun.spawnSync(["git", "rev-parse", "-q", "--verify", `refs/tags/${tag}`]).exitCode === 0) throw new Error(`Tag ${tag} already exists locally.`);

  console.log(`Validating release ${tag} from committed ${branch} HEAD. Unrelated working-tree changes are ignored.`);
  const tempDir = await mkdtemp(join(tmpdir(), "slack-cli-release-"));
  const worktree = join(tempDir, "checkout");
  try {
    run(["git", "worktree", "add", "--detach", worktree, "HEAD"], { quiet: true });
    run(["bun", "test"], { cwd: worktree });
    run(["bun", "build", "--compile", "--outfile", join(tempDir, "slack-cli"), "index.ts"], { cwd: worktree });
  } finally {
    const worktrees = new TextDecoder().decode(Bun.spawnSync(["git", "worktree", "list", "--porcelain"]).stdout);
    if (worktrees.includes(worktree)) {
      Bun.spawnSync(["git", "worktree", "remove", "--force", worktree]);
    }
    await rm(tempDir, { recursive: true, force: true });
  }

  packageJson.version = next;
  await writeFile("package.json", `${JSON.stringify(packageJson, null, 2)}\n`);
  await writeFile("src/version.ts", source.replace(`VERSION = "${current}"`, `VERSION = "${next}"`));
  try {
    run(["git", "add", "--", ...versionFiles], { quiet: true });
    run(["git", "commit", "--only", "-m", `release: ${tag}`, "--", ...versionFiles]);
    run(["git", "tag", "-a", tag, "-m", `Release ${tag}`], { quiet: true });
    // GitHub Actions publishes when this tag reaches origin. Atomic push avoids
    // publishing a tag that points at a commit absent from the target branch.
    run(["git", "push", "--atomic", "origin", `HEAD:refs/heads/${branch}`, `refs/tags/${tag}`]);
    console.log(`Published ${tag}; GitHub Actions will build and create the release.`);
  } catch (error) {
    console.error(`Release commit/tag was created locally but was not fully pushed. Inspect with git status and git log before retrying.\n${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  }
}

main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
