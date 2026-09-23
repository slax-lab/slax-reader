# Proposal

## Why

`pnpm web -- ssr:dev` always failed with "Pages does not support custom paths for the Wrangler configuration file" because `wrangler pages dev` has no `--config` flag. The command needs to work so contributors can run the web app's SSR dev server locally.

## What Changes

- `apps/web/config/wrangler-command.mjs` invokes `wrangler pages dev --cwd <generated-dir>` instead of `--config <path>`, since Pages dev auto-discovers `wrangler.toml` from its working directory rather than accepting an explicit config path.
- The stale-redirect cleanup that used to guard against a leftover `apps/web/.wrangler/deploy/config.json` now targets the generated directory (`deploy/local_web/.generated/.wrangler/deploy/config.json`), matching the new `--cwd`.
- `tooling/wrangler-command.test.mjs` asserts the new invocation shape (no `--config`, `--cwd` pointing at the generated dir).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. This is an internal developer-tooling fix to a repository script (`apps/web/config/wrangler-command.mjs`); it does not change any product-facing behavior or capability covered by `openspec/specs/`.

## Impact

- `apps/web/config/wrangler-command.mjs`: `--cwd` replaces `--config`; stale-redirect cleanup path corrected.
- `tooling/wrangler-command.test.mjs`: assertions updated for the new argv shape.
- No API, contract, or deployment behavior changes; `pnpm web -- ssr:dev` now starts instead of always failing.
