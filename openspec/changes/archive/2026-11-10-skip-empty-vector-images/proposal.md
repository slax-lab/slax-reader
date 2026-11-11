# Proposal

## Why

Test-environment vector refreshes return provider HTTP 400 for saved articles containing zero-byte cached images. Read-only R2 checks and the real `VectorSourceRepo.articleInputs` generator reproduce `image: ""` payloads: existing selection checks MIME and the upper byte limit but does not reject an empty image. The raw provider response has not been captured locally, so this proposal does not claim every HTTP 400 has this cause.

## What Changes

- Skip an image whose stored metadata reports zero bytes without downloading it, and skip an empty actual body before base64 encoding.
- Record the skip using the existing image-selection diagnostics with reason `empty`; do not count an empty image toward the four selected images.
- Continue processing valid article text and later valid images. Keep the existing `missing_source_content` failure when no usable text or image remains.
- Preserve existing candidate limits, MIME checks, ownership checks, deduplication, byte budgets, model parameters and genuine provider-error behavior.
- Add focused source and maintenance regression coverage and a local runtime reproduction.

## Capabilities

### New Capabilities

- `vector-image-input-validation`: Exclude zero-byte stored image candidates from embedding inputs while preserving truthful usable-content outcomes. This narrow input-validation capability does not duplicate the unarchived `vector-v5-runtime` identity, maintenance or search delta.

### Modified Capabilities

None. Legacy `bookmark-vector-indexing` governs shard mappings and is unchanged.

## Impact

Primary implementation: `apps/api/src/infra/repository/vectorSources.ts`. Existing tests: `apps/api/test/utils/vectorSources.test.ts`, `apps/api/test/domain/vectorMaintenance.test.ts`, and the established local Workerd test pattern where needed. No schema, runtime configuration, credential, API shape, dependency, client package or generated registration change is expected.

## Non-goals

No source-image refetch, R2/database repair, content mutation, general image decoder, new retry platform, suppression of arbitrary provider errors, model/mean change, production deployment or batch rerun. Database access remains read-only. Existing local skills and unrelated untracked files are preserved.
