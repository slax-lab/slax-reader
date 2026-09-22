# Proposal

## Why

The root manifest currently needs a separate script for every Web and Extension action, so contributors must remember app-specific root aliases and the skeleton grows as app scripts change. A stable dispatcher convention makes the two frontend entry points predictable while keeping each app's own `package.json` as the command source of truth.

## What Changes

- Add root `web` and `extension` dispatchers invoked as `pnpm web -- <command>` and `pnpm extension -- <command>`.
- Forward command arguments and exit status to the selected app workspace package.
- Remove the duplicated root `dev:*`, `build:*`, `test:*`, `typecheck:*`, and Extension zip aliases for these apps.
- Keep app-local scripts authoritative and document the dispatcher convention for contributors.
- Reserve the analogous `pnpm api -- <command>` convention for the future backend work; this change does not implement it.

## Capabilities

### New Capabilities

- `app-command-dispatch`: Stable root dispatchers for running Web and Extension package scripts.

### Modified Capabilities

- None.

## Impact

- Affects the root `package.json`, `tooling/` dispatch scripts, frontend development documentation, and the migration OpenSpec record.
- Removes several root script names, so contributors using those aliases must switch to the documented dispatcher form.
- No runtime application code, API contract, or dependency behavior changes.
