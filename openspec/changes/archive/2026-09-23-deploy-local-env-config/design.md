# Design

## Context

The root `web` and `extension` scripts already validate a requested app command and spawn the workspace package through `tooling/run-app.mjs`. The two app config loaders still read app-local files, while `tooling/preflight.mjs` contains a second environment parser and points contributors at those app-local paths. Node.js 22.13 or newer is guaranteed by the repository engine constraint, so the tooling can use the built-in `node:util` environment parser without adding a root dependency.

## Goals / Non-Goals

**Goals:**

- Make the deploy directories the single documented source for root Web and Extension commands.
- Keep file resolution, precedence, and validation consistent between dispatch and preflight.
- Keep secrets out of Git and avoid printing values.
- Preserve direct app invocation compatibility by leaving existing app-local loader support in place as a fallback.
- Keep backend deployment configuration and backend command dispatch out of scope.

**Non-Goals:**

- Do not change the app-specific environment schemas or required/optional provider behavior.
- Do not make a root `.env` an accepted configuration source.
- Do not move backend files or add a backend deploy directory.
- Do not add a new runtime package solely for environment loading.

## Decisions

### Use one root tooling module for parsing and merging

Add `tooling/env-files.mjs` with functions for:

- Mapping an app to `deploy/local_web` or `deploy/local_extension`.
- Mapping `development` to the requested `.env.dev` profile filename and other supported profiles to `.env.<profile>`.
- Parsing a file with `util.parseEnv`, returning a file-specific error without exposing values.
- Merging `.env` first and the selected profile second, then applying the invoking process environment last.
- Reading sources for preflight without mutating the current process.

The root dispatcher and preflight import this module. A duplicated parser was rejected because the current preflight parser and app loader can otherwise drift in precedence or filename behavior.

Choose the profile from an explicit preflight `--env`, the process `SLAX_ENV`, or the base deploy `.env`, falling back to `development`. Validate that selection against the four supported profiles before resolving its filename. Keep the selected `SLAX_ENV` in the child environment so a profile file cannot change the selection after being loaded. All app commands use these rules. Because `util.parseEnv` tolerates invalid assignments, validate assignment names and quoted value boundaries first, retaining multiline quoted values and comments. Preflight accepts the optional `--` separator and reports an invalid app configuration without skipping the other app.

### Pass a child-only environment through the dispatcher

After validating the requested command, `run-app.mjs` calls the shared loader and passes the merged object as `spawn(..., { env })`. The parent Node process is never mutated. Loading happens after help/unknown-command handling, so asking for usage does not depend on a local deploy directory.

If parsing fails, the wrapper prints the app and file path, sets a non-zero exit status, and does not spawn pnpm. The message contains no parsed value.

### Keep app-local loaders as a compatibility fallback

The existing `apps/web/config/env.ts` and `apps/extension/config/env.ts` behavior remains available for contributors who invoke an app package directly. Root commands always place deploy values in the child process first, so the current dotenv calls cannot override them. This avoids a migration-breaking change while making root-level commands and preflight follow the new layout.

### Move examples and update onboarding

Create deploy examples by migrating the tracked app examples, changing copy commands and comments to the deploy paths. Remove the old tracked app examples to leave one obvious onboarding location. Update Chinese and English Web, Extension, and contributor guides, plus the preflight hint and tests. Real deploy files are ignored by the existing env ignore rule; only the examples are explicitly unignored.

### Verify behavior with focused tooling tests

Add tests for profile filename selection, base/profile/process precedence, missing files, malformed file errors, and child-environment isolation. Update preflight tests to use deploy example paths and assert the new hints. Run syntax checks, focused Node tests, strict OpenSpec validation, and `git diff --check`.

## Risks / Trade-offs

- **[Risk]** Contributors invoke app-local package scripts directly and expect deploy files to load. **Mitigation:** root commands remain the documented path, and existing app-local loaders remain a compatibility fallback; direct-command support can be added later without changing the deploy contract.
- **[Risk]** Existing `.env.development` habits do not match the new `.env.dev` name. **Mitigation:** document the exact profile names and make the development example explicit; no real files are copied or modified automatically.
- **[Risk]** A malformed file blocks a command that previously started with partial values. **Mitigation:** fail before spawn with a file path and a clear correction target, while never including values in diagnostics.
- **[Risk]** Removing app examples leaves stale links. **Mitigation:** search all tracked docs/tests for the old paths and update them in the same change.

## Migration Plan

1. Add shared environment tooling, dispatcher integration, deploy directories, and example files.
2. Update preflight, tests, ignore rules, and all frontend documentation.
3. Validate with focused tests and strict OpenSpec checks.
4. Contributors copy the new example into the deploy directory; existing app-local files continue to work for direct app commands during the transition.
5. Rollback by reverting the change; the app package scripts and backend layout remain independent.
