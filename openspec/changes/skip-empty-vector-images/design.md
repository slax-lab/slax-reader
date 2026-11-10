# Design

## Context

See proposal.md for the observed zero-byte R2 objects and reproduced empty image inputs. The source already tracks selected images and skip reasons, and throws when neither text nor an eligible image is present.

## Decisions

- Check `imageHead.size === 0` before downloading an image and increment the existing `empty` skip counter.
- Read the image body once into a Buffer, check `byteLength === 0`, and only then base64-encode it. This covers the actual empty-body contract without new retries or storage state.
- Leave valid-image selection counters, deduplication and all existing limits in their current locations after validation. Preserve the final no-content guard.
- Keep provider validation and failure propagation unchanged; do not generalize the fix to every HTTP 400 or attempt a new decoder.

## Verification boundary

Unit and maintenance tests use existing fixtures. Read-only saved-content replay exercises the actual generator with the identified zero-byte objects; it does not claim a direct provider replay without a locally supplied Jina credential. No database or R2 mutation, rollout or backfill is part of this fix.
