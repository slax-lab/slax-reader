# Proposal

## Why

The public API configuration currently issues login JWTs for 30 days. Extend that configured lifetime to 60 days using the existing signing and renewal mechanism, as approved by the user in conversation on 2026-11-04.

## What Changes

- Change the public template's `JWT_EXPIRES` from `2592000` to `5184000` seconds.
- Document the corresponding operator update in each selected private deployment configuration; changing the public template alone does not update live environments.
- Preserve existing JWT verification, renewal endpoints, client refresh scheduling, the 60-day Web cookie, and PowerSync credentials. Introduce no refreshToken.
- Already issued tokens retain their signed expiration; the new duration applies when login or existing renewal issues a new token with the updated configuration.

## Capabilities

### New Capabilities

- `login-token-lifetime`: Configured 60-day login JWT issuance and preservation of existing signed expiration boundaries.

### Modified Capabilities

None. Private runtime configuration continues to follow `api-runtime-configuration`.

## Impact

- Public API configuration template and English API deployment documentation.
- Operators must synchronize the selected private environment's `[vars].JWT_EXPIRES` before its next source deployment.
- No application source, API shape, client package output, dependency, database, or UI changes; no CLI, Extension, or Mobile version increment is applicable.

## Approval

The user approved doubling the existing login Token lifetime to 60 days without adding refreshToken, and then explicitly requested implementation in a new worktree and a pull request. This document records that approved configuration-only scope.
