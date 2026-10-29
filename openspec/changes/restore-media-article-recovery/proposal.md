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

Do not enable Labs silently, regenerate content for visitors, change budgets, or add unsupported claims to transcripts. Production account diagnosis requires an authenticated owner session or server records.

## Verification correction — 2026-10-27

The original user outcome includes a readable generated article. Request recovery tests alone do not establish that outcome.
Luca requested visitor transcript access as the immediate minimum after owner login proved difficult.
Verify the real public transcript independently. Keep production article publication and human acceptance explicitly unresolved.

## Readability correction — 2026-10-27

Luca rejected the caption-line screenshots as unreadable and requested an implemented fix with screenshots.
The reader must present continuous transcript paragraphs without requiring owner login or AI article availability.
Group adjacent cues at sentence boundaries, speaker changes, and long pauses. Show one quiet seek control per reading paragraph.
Preserve caption text, cue nodes, highlight paths, and the detailed transcript panel.
This is a formatting correction within the existing reading surface. It does not add a new navigation flow or invent section headings.

## Approved YouTube expansion — 2026-10-27

Luca approved the Papears-based plan in conversation and requested implementation followed by screenshots.
The prior preview recommendation does not require a separate preview before implementation under this instruction.
This expansion is a material Web reading change. Human acceptance of the implemented page remains pending.

- Edit the complete source transcript before translating it. Preserve claims, examples, chronology, and source references.
- Generate a short introduction from the complete edited article.
- Add topic navigation, readable paragraphs, quiet playback controls, and source notes.
- Verify complete caption coverage and distinguish generation from body publication.
- Keep published content readable when generation is disabled. Preserve access checks and existing annotations.

Keep this expansion in the existing change because both touch the same YouTube capability.
Podcast presentation is outside this expansion. No production regeneration or deployment is authorized by this work.
