
Default to using Bun instead of Node.js.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun build <file.html|file.ts|file.css>` instead of `webpack` or `esbuild`
- Use `bun install` instead of `npm install` or `yarn install` or `pnpm install`
- Use `bun run <script>` instead of `npm run <script>` or `yarn run <script>` or `pnpm run <script>`
- Use `bunx <package> <command>` instead of `npx <package> <command>`
- Bun automatically loads .env, so don't use dotenv.

## APIs

- `Bun.serve()` supports WebSockets, HTTPS, and routes. Don't use `express`.
- `bun:sqlite` for SQLite. Don't use `better-sqlite3`.
- `Bun.redis` for Redis. Don't use `ioredis`.
- `Bun.sql` for Postgres. Don't use `pg` or `postgres.js`.
- `WebSocket` is built-in. Don't use `ws`.
- Prefer `Bun.file` over `node:fs`'s readFile/writeFile
- Bun.$`ls` instead of execa.

## Testing

Use `bun test` to run tests.

```ts#index.test.ts
import { test, expect } from "bun:test";

test("hello world", () => {
  expect(1).toBe(1);
});
```

## Frontend

Use HTML imports with `Bun.serve()`. Don't use `vite`. HTML imports fully support React, CSS, Tailwind.

Server:

```ts#index.ts
import index from "./index.html"

Bun.serve({
  routes: {
    "/": index,
    "/api/users/:id": {
      GET: (req) => {
        return new Response(JSON.stringify({ id: req.params.id }));
      },
    },
  },
  // optional websocket support
  websocket: {
    open: (ws) => {
      ws.send("Hello, world!");
    },
    message: (ws, message) => {
      ws.send(message);
    },
    close: (ws) => {
      // handle close
    }
  },
  development: {
    hmr: true,
    console: true,
  }
})
```

HTML files can import .tsx, .jsx or .js files directly and Bun's bundler will transpile & bundle automatically. `<link>` tags can point to stylesheets and Bun's CSS bundler will bundle.

```html#index.html
<html>
  <body>
    <h1>Hello, world!</h1>
    <script type="module" src="./frontend.tsx"></script>
  </body>
</html>
```

With the following `frontend.tsx`:

```tsx#frontend.tsx
import React from "react";
import { createRoot } from "react-dom/client";

// import .css files directly and it works
import './index.css';

const root = createRoot(document.body);

export default function Frontend() {
  return <h1>Hello, world!</h1>;
}

root.render(<Frontend />);
```

Then, run index.ts

```sh
bun --hot ./index.ts
```

For more information, read the Bun API docs in `node_modules/bun-types/docs/**.mdx`.

## slack-cli product standards

This is an agent-oriented CLI. Prefer explicit, inspectable behavior over
shortcuts that can cause an unintended Slack mutation.

### Mutation safety

- Every command that could mutate Slack must preview by default. A preview may
  perform read-only work such as resolving a channel or user, but it must never
  call the mutating Slack endpoint.
- `--allow-write` is the only flag that authorizes a mutation. Do not add a
  second confirmation flag or a separate opt-in mode.
- The default preview must show the resolved operation: method, resolved IDs,
  normalized parameters, and the form-encoded wire parameters where relevant.
- Apply this rule uniformly to dedicated commands and `api` calls. Unknown API
  methods still require `--unsafe-method`, and preview by default because their
  mutability cannot be established locally.
- Do not infer permission to write from a request to research, draft, inspect,
  or format a message.

### References and message composition

- Accept a channel ID, bare visible channel name, or `#channel` everywhere a
  command accepts a channel. Resolve known API `channel` parameters through the
  shared resolver; keep unknown unsafe API parameters transparent.
- Keep workspace identity data in the shared cache. `users find` returns IDs
  and candidate names; do not reimplement lookups in individual commands.
- In outbound message text, only `@{Name}` is a mention request. Resolve it to
  `<@USER_ID>` and fail on missing or ambiguous matches. Never rewrite ordinary
  `@Name` text automatically.
- Preserve plain text by default. Rich formatting, including bullet lists, is
  opt-in (`--format=rich`) and raw Block Kit remains available through
  `--blocks`; always retain a plain-text fallback.

### API and verification standards

- Direct API input accepts inline JSON or `@file.json`. Arrays and objects must
  be JSON-encoded for Slack's form transport; never use JavaScript `String()`
  for structured values.
- Put reference normalization and request preparation in shared layers before
  the transport client. Command modules should not each invent their own wire
  encoding or channel lookup.
- Keep `bun run typecheck` and `bun test` passing for every change. Add focused
  tests for any new serialization, resolver, write-preview, or safety behavior.
