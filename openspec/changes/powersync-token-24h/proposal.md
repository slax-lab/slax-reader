# Proposal

## Why

PowerSync credentials currently expire after five minutes, causing frequent credential acquisition despite clients already supporting expiry-based reuse. Issue credentials for 24 hours minus one second, staying strictly below PowerSync's 86,400-second JWT limit as requested.

## What Changes

- Set PowerSync JWT expiration to exactly 86,399 seconds after its issued-at timestamp, calculated from one clock reading.
- Verify the signed token's lifetime, audience, subject, signing metadata, and expiration boundary with synthetic test keys.
- Preserve login token policy and the existing sync endpoint response.

## Capabilities

### New Capabilities

- `powersync-authentication`: Authenticated issuance of PowerSync credentials with a lifetime of 24 hours minus one second.

### Modified Capabilities

None.

## Impact

The implementation affects `apps/api/src/domain/orchestrator/sync.ts` and focused backend tests. Web and mobile clients already consume the signed expiry. There are no API shape, dependency, schema, configuration, or UI changes. Existing tokens retain their signed expiration; new tokens receive the new lifetime after deployment.
