# Proposal

## Why

Forked articles can remain readable while outline, overview, and chat fail because their saved AI text is empty. A local reproduction confirms that a saved `<div>` fragment is copied successfully but `SnapshotBundle.copyHtml` selects LinkeDOM's empty synthetic body and publishes zero text characters.

## What Changes

- Extract snapshot text correctly from HTML fragments and full documents, excluding scripts, styles, and embedded snapshot metadata.
- Restore AI access for existing copies with an empty conventional HTML text object by deriving text from that same destination's saved HTML at read time.
- Keep nonempty text, PDF handling, access checks, moderation, subscription checks, and missing-content errors intact.
- Add focused regressions and exercise the fork-to-AI path locally with deterministic provider fixtures.

## Capabilities

### New Capabilities

- `snapshot-ai-text`: AI-readable text must correspond to the saved HTML snapshot, including recovery of existing empty text copies.

### Modified Capabilities

None. The active `add-bookmark-fork` change owns creation, provenance, and lifecycle policy; `outline-summary-format` owns output formatting. This change adds only the shared saved-text contract and carries no overlapping deltas for those capabilities.

## Impact

API snapshot extraction, the shared bookmark-content read boundary, and focused API tests/runtime fixtures. No schema, API payload, frontend presentation, provider, or dependency change is planned. Production credentials and the supplied bearer token will not be persisted in artifacts or fixtures.

## Review status

The requesting owner approved implementation on 2026-11-03, explicitly including both new Forks and existing affected copies. Investigation and the four existing snapshot-bundle tests passed before implementation. The reported production bookmark has not been inspected, so the local reproduction establishes a concrete defect matching the symptoms rather than proving the state of that particular record.
