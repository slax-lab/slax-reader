# Complete the first explicit save after sign-in

## Context

Chrome reproduced one guest click, zero saves on return and one save only after another click. The existing Fork specification explicitly requires this second click.

## Goals / Non-Goals

Carry one explicit public snapshot save across its own sign-in and complete it once. Show the admitted copy or an actionable error.

## Decisions

Carry the source and a bounded continuation through the initiated auth flow. Resolve the action once the authenticated identity is known, using the existing Fork admission and idempotency. Complete at the auth handoff before depending on an already-open source page. Distinguish abandonment from provider round trips. A URL or analytics attribution alone cannot authorize a save.

## Risks / Trade-offs

Use the follow-up name reserved by snapshot-save-observability. Review the previously requested measurement baseline before implementation. Sequence with enable-labs-on-fork and polish-web-subscription-and-fork-ui before archival.

## Verification

Use the affected Web entry point in a running browser and record the observed result for each scenario.

Only a real user activation counts as a save-button click. Let the existing admission outcome record the automatically resumed operation. Do not synthesize a second click for analytics. Read the existing baseline alongside the proposed conversion change.
