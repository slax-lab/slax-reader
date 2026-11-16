# Proposal

## Why

Two test-environment articles fail embedding because an optional stored image exceeds Jina's per-image maximum of 5,242,880 raw bytes. A complete replay on 2026-11-11 reproduced HTTP 422 for an 8,622,081-byte PNG and a 7,083,321-byte GIF, while the other six selected images succeeded; the existing 12 MiB JSON-request budget does not enforce this separate image limit.

## What Changes

- Skip an individual stored article image when its raw size exceeds 5 MiB (5,242,880 bytes), before requesting its body when metadata already establishes the excess and before encoding if the retrieved bytes exceed it.
- Keep text and eligible later images, preserve the existing four-selected-image and 32-candidate limits, and record the skip reason `image_too_large`. Images exactly at the limit remain eligible under the other existing checks.
- Preserve explicit `missing_source_content` when no usable content remains and preserve unrelated provider failures.
- Add focused regression coverage and replay the two affected articles locally using the corrected input builder, read-only test sources, and real provider calls without writing remote vectors.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `vector-image-input-validation`: Exclude images exceeding the provider's raw-byte limit without failing otherwise usable article content.

## Impact

Expected code changes are limited to the image-limit constant in `apps/api/src/utils/vectorEmbedding.ts`, image selection in `apps/api/src/infra/repository/vectorSources.ts`, and regression cases in `apps/api/test/utils/vectorSources.test.ts`. Regenerate required API artifacts through the existing generator and review any resulting diff. No schema, API contract, dependency, client package, preference-maintenance, or stored-source changes are intended.

No image compression, source refetch, blanket suppression of HTTP 422, deployment, full reindex, or deletion of existing data is included. Delivery is a task pull request targeting `dev` after implementation, verification, and local review.

## Approval and source check

On 2026-11-11, the user approved implementation and PR delivery, with an optional WeChat WebP exception only if the affected legacy URLs had omitted WebP selection. Read-only inspection of both oversized samples found `mmbiz.qpic.cn` URLs already carrying `tp=webp&wxfrom=5`, while their stored MIME types remained PNG and GIF. The omission condition is not present, so this change retains the existing WebP handling and implements only the raw-size skip. The user did not authorize deployment.
