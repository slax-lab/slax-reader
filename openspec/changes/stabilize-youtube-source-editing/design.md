## Design

Assign stable passage keys from ordered, non-overlapping cues. Return passage text by key and derive paragraph references on the server. Reject edits that change substantive lexical order, fall back locally to the source, and keep provider failures retryable under existing spend and truncation limits. Cache edited and translated passages independently. Require the canonical article quality gate before publishing.

## Recovery

Use the passage editor directly for v2 chunks. Store edit and translation checkpoints under the existing chunk prefix. Reuse completed chunks during retries.

Source checks compare words in order and retain numeric signs, decimals and currency tokens. A rejected edit uses its entire original passage. Translation checkpoints accept keyed, nonempty results with required headings. The pre-existing full-document language, number, length, duplicate and coverage checks still gate publication. These checks do not establish semantic translation fidelity.
