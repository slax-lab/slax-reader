# Proposal

## Why

The test deployment returns Jina HTTP 422 while identical reconstructed article inputs succeed with the maintainer's temporary credential. Current error handling discards Jina's code/detail, preventing diagnosis and causing unsupported rate-limit hypotheses.

## What Changes

- Add bounded, redacted structured error logging for failed Jina requests, retaining provider code, detail and request ID without article text, API credentials, request body or full provider responses.
- Keep existing error reasons, retry behavior, vector state and request semantics unchanged.
- Validate sanitization, then deploy only to the authorized test environment and replay the two failing source articles.

## Capabilities

### New Capabilities

- `embedding-provider-diagnostics`: observable provider failure classification with privacy-preserving diagnostic evidence.

### Modified Capabilities

None.

## Impact

`apps/api/src/infra/external/vectorEmbedding.ts` and its existing tests, plus local test-environment verification. No schema, dependency, client contract or production configuration changes.

## Approval

The maintainer explicitly requested urgent diagnostic logging on 2026-11-11, authorizing implementation and test-environment verification/deployment. Production is excluded.
