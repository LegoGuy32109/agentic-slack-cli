# TODO

## Completed in v0.3.0

- Verified self-update (`--version`, `update --check`, and `update`) with
  platform asset selection, SHA-256 verification, downgrade protection, atomic
  replacement, and a Windows replacement helper.
- Release workflow publishes `SHA256SUMS`; installer defaults to a user-writable
  location and verifies downloads before installation.
