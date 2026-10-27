# Proposal

## Why

Media status responses replace the default CORS and JSON headers with a cache header. Browsers cannot read these responses, and YouTube status failures remain invisible.

## What Changes

- Preserve JSON and CORS headers when a controller supplies cache headers.
- Show failed YouTube status requests with an explicit retry action.
- Explain disabled Labs and missing source records to the owner, without exposing these details to visitors.
- Preserve existing access rules, generation limits, and immutable fork behavior.

## Capabilities

### New Capabilities

- `media-api-responses`: Browser-readable media responses with private cache policy.

### Modified Capabilities

- `youtube-ai-article`: Visible request failures and owner-only recovery guidance.

## Impact

API response helpers, media controller tests, YouTube status service, an optional response field, and Web status components change. No dependency or database migration is required. Other applications do not consume the new optional field.

## Approval and boundaries

Luca approved the two proposed fixes in conversation on 2026-10-27 and requested planning and implementation. This change implements the first proposal. Existing status patterns remain in place; this is not a material UX change. Human hands-on acceptance remains required before opening the PR.

The merged bookmark-fork change also carries YouTube deltas. Archive that change before this change. The separate Pocket Casts change owns podcast capture requirements.

## Non-goals

Do not enable Labs silently, regenerate content for visitors, change budgets, or rewrite transcripts as editorial essays. Production account diagnosis requires an authenticated owner session or server records.
