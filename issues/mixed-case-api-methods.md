# Direct API support for Slack List reads

**Priority:** P1
**Status:** Open

## Summary

The direct API command rejects Slack's mixed-case List method name locally,
preventing an otherwise supported, read-only operation from being called. The
reviewed API catalog also lacks that operation, leaving agents without a safe
discoverable path to list rows.

## Evidence

- `src/commands/api.ts` validates method names with
  `^[a-z]+(?:\.[a-zA-Z]+)+$`; this rejects `slackLists.items.list` before any
  request is sent. Method names must retain their case, because lowercasing
  reaches Slack as a different, unknown method.
- The same module's local `methods` catalog contains no Slack Lists entry.
  Unknown methods require `--unsafe-method` and preview unless
  `--allow-write` is supplied, which is the intended conservative behavior.
- Slack documents [`slackLists.items.list`](https://docs.slack.dev/reference/methods/slackLists.items.list/)
  as a read operation requiring `list_id` and the `lists:read` scope.
- A smoke test against Environment Tracker (`F0A7CDM1KKL`) on 2026-07-29
  reached Slack after local validation but returned `not_allowed_token_type`.
  The CLI's stored `xoxc` browser-session credential is therefore not an
  accepted token type for this public Lists endpoint, despite working for
  `files.info` metadata reads.
- A browser capture identifies a separate internal multipart endpoint,
  `lists.cells.update`, for cell changes. This requires a dedicated browser
  transport and must not be represented as a public API catalog method.

## Decision

Broaden only the lexical method-name validator; do not normalize names. Use a
conservative expression such as
`^[A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z][A-Za-z0-9]*)+$`, which accepts
mixed-case and versioned segments while rejecting malformed names.

Add `slackLists.items.list` to the local catalog as a read operation with a
`{ list_id: "F123" }` example. Retain both gates for every unknown method:
`--unsafe-method` acknowledges an unreviewed endpoint, while `--allow-write`
authorizes a possible mutation. Do not introduce an "unsafe read" bypass
based on a method name or HTTP verb.

## Acceptance criteria

- `slack-cli api slackLists.items.list --params '{"list_id":"F123"}'` is
  accepted by validation and can execute without `--unsafe-method` or
  `--allow-write` when a supported token provider is configured.
- Unit tests accept `slackLists.items.list` and `oauth.v2.access`, and reject
  malformed method names.
- Catalog tests describe `slackLists.items.list` as read-only and preserve its
  example parameters.
- A credentialed smoke test confirms Slack receives the method name unchanged
  and returns rows when a suitable paid workspace, `lists:read` permission,
  and supported token type are available.

## Out of scope

- List creates and updates are separate mutation features. Slack documents
  [`slackLists.items.create`](https://docs.slack.dev/reference/methods/slackLists.items.create/)
  and [`slackLists.items.update`](https://docs.slack.dev/reference/methods/slackLists.items.update/),
  but each needs its own payload review, preview tests, and `--allow-write`
  coverage.
- `api` help and uncatalogued-method guidance are usability improvements and
  should be tracked separately.
- Canvas-specific support has no verified workflow here; `files.info` already
  exposes Canvas metadata.
