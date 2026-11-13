# Release maintenance

The public repository owns the GitHub installer, release workflow, version files, and binary updater.
Runtime features also exist in work-portal. Compare both trees before syncing, and preserve changes unique to either checkout.

The current merge adds editing, file uploads, thread replies, upload verification, a shared method catalog, and mention warnings.
It retains the public checkout's complete unread scan, timestamp-bounded marking, mixed-case API method validation, installer, and updater.
The `mark <timestamp>` interface is deliberate. Do not replace it with the older per-channel interface.

Before release:

1. Review the complete working diff, including existing local changes.
2. Run `bun run typecheck`, `bun test`, and `bun run build`.
3. Confirm demo screenshots contain only approved synthetic workspace content.
4. Get maintainer approval to commit, push, and publish.
5. Commit the intended source changes before running the release script.

From the committed branch, an approved release uses one of:

```sh
bun run release patch
bun run release minor
bun run release major
```

The script validates committed HEAD in a temporary worktree, updates the version files, creates a release commit and tag, and pushes atomically.
It excludes other uncommitted changes. The tag triggers three binary builds and publication of `SHA256SUMS` through GitHub Actions.
The next version must exceed the installed version for ordinary `slack-cli update` to offer it.

Preserve these asset names because existing installers and updaters depend on them:

- `slack-cli-linux-x64`
- `slack-cli-mac-arm64`
- `slack-cli-windows-x64.exe`
- `SHA256SUMS`

After publication, check the release assets and run `slack-cli update --check` from an older installed binary.
Verify a real update on a disposable copy before treating the release as delivered.

Builds cross-compile on Linux to avoid macOS runner queues. To finish an existing
release tag, dispatch the Release workflow with its `tag` input. The workflow
checks out that tag without moving it.
