# TODO

## Self-update command

Add a production-grade update path so installed users can run `slack-cli update` rather than rerunning the curl installer.

- Add `slack-cli --version`, `slack-cli update --check`, and `slack-cli update`.
- Embed the release version in compiled binaries and compare it to the GitHub latest release.
- Detect the current OS and architecture and select the matching release asset.
- Update the release workflow to publish `SHA256SUMS` for every binary; download and verify the matching checksum before installation.
- Download to a temporary file, make it executable, and atomically replace the executable only after verification. Preserve the existing binary on failure.
- Refuse downgrades by default; permit them only with `--force`.
- Keep credentials, profiles, and the user-name cache intact: updating replaces only the binary.
- Prefer a user-writable installation directory such as `~/.local/bin` for new installs. For existing system-wide installs (for example `/usr/local/bin`), clearly request elevation only when replacement needs it.
- Implement Windows replacement through a short-lived helper process because a running executable is locked there.
- Keep updates explicit—never silently update an agent's executable.
- Document the command, platform behavior, integrity verification, and failure/recovery behavior in the README.
