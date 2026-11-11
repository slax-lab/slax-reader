# Proposal

## Why

The test deployment returns Jina HTTP 422 while identical reconstructed article inputs succeed with the maintainer's temporary credential. Current error handling discards Jina's code/detail, preventing diagnosis and causing unsupported rate-limit hypotheses.

## What Changes

- Add bounded, redacted structured error logging for failed Jina requests, retaining provider code, detail and request ID without article text, API credentials, request body or full provider responses.
- Keep existing error reasons, retry behavior, vector state and request semantics unchanged.
- Validate sanitization, then open the diagnostic PR without deploying or replaying the test environment.

## Capabilities

### New Capabilities

- `embedding-provider-diagnostics`: observable provider failure classification with privacy-preserving diagnostic evidence.

### Modified Capabilities

None.

## Impact

`apps/api/src/infra/external/vectorEmbedding.ts` and its existing tests, plus local test-environment verification. No schema, dependency, client contract or production configuration changes.

## Approval

The maintainer first authorized urgent diagnostics, then explicitly changed delivery on 2026-11-11: open the PR only. No deployment or test-environment replay is authorized here. Production is excluded.
