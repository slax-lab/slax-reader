# Tasks

## 1. Fix the wrangler pages dev invocation

- [x] 1.1 Replace `--config <path>` with `--cwd <generated-dir>` in `apps/web/config/wrangler-command.mjs` and verify `pnpm web -- ssr:dev` starts the Pages dev server instead of failing with "Pages does not support custom paths for the Wrangler configuration file"
- [x] 1.2 Update `tooling/wrangler-command.test.mjs` to assert the new argv shape (no `--config`, `--cwd` pointing at the generated dir) and verify the test suite passes

## 2. Fix the stale-redirect cleanup path

- [x] 2.1 Retarget the cleanup in `apps/web/config/wrangler-command.mjs` (currently `apps/web/.wrangler/deploy/config.json`) to the generated directory's redirect file (`deploy/local_web/.generated/.wrangler/deploy/config.json`), matching the new `--cwd`, and verify the test suite still passes
