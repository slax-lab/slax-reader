# Complete the first explicit save after sign-in

**Approved on November 25, 2026.** The change requester approved the proposed scope and behavior.

## Why

Chrome reproduced one guest click, zero saves on return and one save only after another click. The existing Fork specification explicitly requires this second click.

## What Changes

- **Product behavior change.** This proposal replaces the current explicit second click. Carry one explicit public snapshot save across its own sign-in and complete it once. Show the admitted copy or an actionable error.
- When a visitor cancels sign-in, opens a plain return URL or later signs in independently, no article is saved on that account.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bookmark-fork` — Complete the first explicit save after sign-in.

## Impact

apps/web/app/composables/bookmark/useBookmarkFork.ts, SnapshotForkButton.vue and Web auth continuation handlers.

Use the follow-up name reserved by snapshot-save-observability. Review the previously requested measurement baseline before implementation. Sequence with enable-labs-on-fork and polish-web-subscription-and-fork-ui before archival.

[useBookmarkFork.ts](../../../apps/web/app/composables/bookmark/useBookmarkFork.ts) · [Current Fork requirement](../../../openspec/specs/bookmark-fork/spec.md) · [Save measurement and approved sequencing](../../../openspec/changes/snapshot-save-observability/proposal.md)

## Demo approval

On November 25, 2026, the change requester approved the interactive Web demo for save continuation, cancellation and retry and authorized implementation as shown.
