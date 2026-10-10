# Proposal

## Why

Separating runtime values between private TOML and manually maintained Worker Secrets caused missing bindings after the backend migration. The operator has requested one private configuration file per environment, including runtime credentials.

## What Changes

- Allow runtime strings, including credentials, in the selected private TOML's `[vars]` table and publish them to all four Workers through normal Wrangler deployment.
- Preserve remote bindings that have not yet been recovered; explicitly configured values replace matching remote bindings. Never substitute empty credentials for unavailable original values.
- Restore recoverable legacy runtime values in the independent private configuration repository and document the remaining operator inputs there.
- Keep deployment access credentials in environment-scoped Actions Secrets, private output captured, and executable private configuration rejected.
- Preserve merged-PR eligibility, environment mapping, migration order, resource identities and cleanup. Add no secret-upload stage, manifest or deployment framework.

## Capabilities

### New Capabilities

- `api-runtime-configuration`: Single private source for runtime bindings with safe release loading and incremental recovery.

### Modified Capabilities

None. This explicitly supersedes the runtime-credential exclusion recorded in the completed `merge-triggered-api-deploy` change; deployment access credentials remain protected Actions inputs.

## Impact

The API configuration validator/generator, existing deployment command, release loader, operator guides and existing configuration regressions change. The private repository's three TOMLs and README change separately. No business source, database schema, dependency or cloud resource changes are required. Implementation follows the operator's explicitly requested storage policy; no live deployment is part of verification.
