# Proposal

## Why

PR #110's non-blocking review identified missing application type checks, an empty Axios export, inconsistent signal forwarding, and unnecessarily broad dependency install-script permissions.

## What Changes

- Run actual Web and Extension type checks in CI using non-secret placeholder configuration, and record the behavior with absent/empty configuration.
- Expose the existing Axios implementation and types through the declared frontend-utils subpath.
- Forward repeated termination signals until the Wrangler child exits.
- Restore the existing workspace policy blocking protobufjs and sharp install scripts, validating supported prebuilt installations and frontend builds.
- Keep this follow-up under one change-id; do not rewrite the merged migration PR or archive its other changes as part of this task.

## Capabilities

### New Capabilities

- `frontend-toolchain-validation`: Frontend type-check gates, shared Axios import surface, local process termination, and dependency installation policy.

### Modified Capabilities

None.

## Impact

Frontend CI, packages/frontend-utils, the Web Wrangler command wrapper, pnpm workspace configuration, and targeted regression tests. No backend configuration, API contracts, production credentials, or legacy repositories change.
