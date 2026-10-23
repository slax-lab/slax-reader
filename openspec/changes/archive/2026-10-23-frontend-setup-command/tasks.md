# Tasks

## 1. Web `setup` command

- [x] 1.1 Add a `"setup"` script to `apps/web/package.json` running `pnpm run type` (delegates to the existing `type` script rather than duplicating its command) and verify `pnpm web -- help` lists `setup` in the available commands
- [x] 1.2 Verify the fix end-to-end: remove `apps/web/.nuxt`, run `pnpm web -- setup`, confirm `apps/web/.nuxt/tsconfig.server.json` exists, then run `pnpm web -- dev` and confirm the dev server starts with no `TSCONFIG_ERROR` for `tsconfig.server.json`

## 2. Extension `setup` command

- [x] 2.1 Add a `"setup"` script to `apps/extension/package.json` running `pnpm run type` (delegates to the existing `type` script rather than duplicating its command) and verify `pnpm extension -- help` lists `setup` in the available commands
- [x] 2.2 Verify: remove `apps/extension/.wxt`, run `pnpm extension -- setup`, confirm `apps/extension/.wxt/tsconfig.json` exists, then run `pnpm extension -- dev` and confirm the dev server starts cleanly

## 3. Documentation

- [x] 3.1 Update `docs/LOCAL-SETUP.md` to add `pnpm web -- setup` and `pnpm extension -- setup` as a step after install/cache-wipe and before the first `pnpm web -- dev` / `pnpm extension -- dev`, and verify the added step matches the actual command names by re-reading the file after editing

## 4. Validation

- [x] 4.1 Run `openspec validate --all --strict` and verify it passes with the new `frontend-dev-lifecycle` capability
- [x] 4.2 Run the local pre-push review defined in `REVIEW.md` (all three passes) and resolve any Important findings before requesting archive or opening a pull request
