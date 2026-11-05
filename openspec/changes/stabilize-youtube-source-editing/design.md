## Design

New workflow starts carry an explicit editing revision. Historical workflow payloads replay with their previous algorithm. Completed chunk and published article representations remain compatible. Scope intermediate checkpoints by the source/version/language chunk prefix and editing revision so takedown and success cleanup include them.

Assign stable passage keys from ordered, non-overlapping cues. Return passage text by key and derive paragraph references on the server. Reject edits that change substantive lexical order, fall back locally to the source, and keep provider failures retryable under existing spend and truncation limits. Cache edited and translated passages independently. Require the canonical article quality gate before publishing.

## Compatibility and recovery

The edit revision is separate from the persisted article version. Newly dispatched v2 rows (including an explicit retry of a previously failed row) carry the revision. R2 checkpoints use it in their keys. Existing v2 finished chunks have already passed their checks and can still be reused. Older workflow payloads retain their original step sequence. The v1 path and existing ready article URLs remain readable.

Source checks compare words in order and retain numeric signs, decimals and currency tokens. A rejected edit uses its entire original passage. Translation checkpoints accept keyed, nonempty results with required headings. The pre-existing full-document language, number, length, duplicate and coverage checks still gate publication. These checks do not establish semantic translation fidelity.
