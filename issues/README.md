# Issues

Create one Markdown file per open issue in this directory. Use a short,
kebab-case name that describes the problem, for example
`mixed-case-api-methods.md`. Do not put issue reports, investigation logs, or
proposed fixes in `NOTES.md`; it records only durable, current behavior and
decisions.

Before opening an issue, reproduce it against the code and verify any
upstream claim against current primary documentation. Do not copy an earlier
agent's diagnosis or proposed solution without checking it. Update an issue as
evidence changes, and remove it only when its implementation and tests have
landed.

## Issue format

```md
# Concise issue title

**Priority:** P1
**Status:** Open

## Summary

One or two sentences describing the user-visible problem and impact.

## Evidence

- Reproduction steps, observed output, and the relevant code location.
- Links to primary upstream documentation, when applicable.

## Decision

The accepted technical direction, including safety or compatibility constraints.
State what must not change.

## Acceptance criteria

- Concrete observable outcome.
- Tests to add or update.
- Any manual or integration verification required.

## Out of scope

Explicitly deferred work and why it is not part of this issue.
```
