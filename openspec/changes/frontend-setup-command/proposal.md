# Proposal

## Why

After a full local cache wipe (deleting `apps/web/.nuxt` and `node_modules`) and a fresh `pnpm install`, the very first `pnpm web -- dev` intermittently fails with:

```
[TSCONFIG_ERROR] Failed to load tsconfig '.nuxt/tsconfig.server.json': Tsconfig not found
```

Root cause (reproduced and verified in a local session): `.nuxt/tsconfig.server.json` is generated asynchronously by Nuxt during its own `dev` startup, and Vite's oxc/vue transform plugins begin pre-transforming server-relevant files before that file is fully written — but only on a true cold start, when `.nuxt/` does not already exist. Running Nuxt's `prepare` step (already exposed as `pnpm web -- type`) before `dev` fully generates `.nuxt/`, including `tsconfig.server.json`, and reliably avoids the race. Extension has the same shape of dependency (`apps/extension/tsconfig.json` extends the WXT-generated `./.wxt/tsconfig.json`, and `apps/extension/package.json` already exposes `type: "wxt prepare"`), though the failure has not been reproduced there.

The Backend already has a command for "bring this app to a state where dev can run cleanly" — `pnpm api -- setup`. Adding the equivalent `setup` entry to Web and Extension gives contributors and agents one consistent command shape across all three apps (`pnpm <app> -- setup`) to run once after a fresh install or cache wipe, instead of only discovering the fix by hitting the race.

## What Changes

- Add a `setup` script to `apps/web/package.json` that delegates to the existing `type` script (`pnpm run type`, which runs `node ./config/nuxt-command.mjs prepare`) to generate `.nuxt/` ahead of `dev`.
- Add a `setup` script to `apps/extension/package.json` that delegates to the existing `type` script (`pnpm run type`, which runs `wxt prepare`) to generate `.wxt/` ahead of `dev`.
- `setup` is the designated place for any future preparation step either app needs before `dev` (the user does not expect it to stay limited to artifact generation); `type` stays a narrower, independently runnable script for callers that only need project preparation (e.g. `typecheck`).
- No changes to `predev` in either app, and no changes to `tooling/run-app.mjs` or the `pnpm web -- ...` / `pnpm extension -- ...` dispatchers: both already discover and forward arbitrary `package.json` scripts, so `pnpm web -- setup` and `pnpm extension -- setup` work with no new plumbing.
- Update `docs/LOCAL-SETUP.md` to add `pnpm web -- setup` / `pnpm extension -- setup` as the step to run once after a fresh install (or after wiping `.nuxt`/`.wxt`), before the first `dev`.
- Out of scope: the API's own `setup` command; this change only adds the analogous Web/Extension `setup` commands.
- The PR implementing this change also carries an unrelated, already-prepared backend fix to `apps/api/src/utils/authLogin/authGoogle.ts` (Google OIDC token verification), folded in by the author rather than split into its own branch/PR. It is not part of this change's capability scope and is not covered by the `frontend-dev-lifecycle` delta spec below; see the PR description for that fix's own rationale.

## Capabilities

### New Capabilities

- `frontend-dev-lifecycle`: defines the `setup` command Web and Extension expose to prepare framework-generated build artifacts (`.nuxt/`, `.wxt/`) before `dev`, so the first `dev` invocation after a clean install does not race the framework's own artifact generation.

### Modified Capabilities

(none — `frontend-local-environment` covers env/config file loading and precedence, not dev-command lifecycle or generated build artifacts, so this change does not touch its requirements)

## Impact

- `apps/web/package.json`: one new `setup` script.
- `apps/extension/package.json`: one new `setup` script.
- `docs/LOCAL-SETUP.md`: one documented step added to the post-install flow.
- No changes to `tooling/`, no changes to CI.
- `apps/api/src/utils/authLogin/authGoogle.ts` changes in the same PR are out of this change's scope (see note above); they carry their own rationale in the PR description, not in this change's artifacts.
