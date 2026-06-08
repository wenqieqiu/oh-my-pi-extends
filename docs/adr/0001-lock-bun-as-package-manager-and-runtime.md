# Lock bun as package manager and runtime

This project is an OMP (Oh My Pi) extension. OMP runs on Bun, and extensions must use the same runtime for dependency resolution and type checking. Using npm/pnpm/node would produce a mismatched lockfile and risk incompatible type declarations. Bun also provides native TypeScript execution and faster installs, which aligns with the project's constraint of zero external dependencies.

## Status

accepted

## Considered Options

- **npm/pnpm/yarn**: would require a compatible Node.js runtime, introducing a second runtime alongside Bun. Lockfile format would differ from `bun.lock`. Must be rejected because OMP loads extensions via Bun's module system.

- **Lock via `preinstall` script**: a Node.js script that inspects `npm_execpath` and rejects non-bun invocations. Rejected because it requires `node` to run — the guard itself depends on the tool it's trying to block.

## Consequences

- Every `package.json` `scripts` entry must be invoked via `bun run` or `bunx`
- CI must use `bun install` / `bun run` — never `npm ci` / `npm run`
- `node_modules/.bin/tsc` should not be called directly; use `bun run tsc` instead
