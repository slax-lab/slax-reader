# Design

## Context

Media controllers supply cache-only headers. `createResponse` currently uses those headers in place of its defaults. The slim YouTube bar does not consume `loadFailed`; the expanded view also hides an initial failure.

## Goals / Non-Goals

Preserve response defaults and reuse existing status presentation. Do not change authentication, snapshot ownership, generation limits, or storage.

## Decisions

- Merge response headers through `Headers` so overrides are case-insensitive. Controller-specific header copies would leave the shared defect in place.
- Add an optional `unavailable_reason` for owner guidance. Keep the existing status union compatible with all clients.
- Return reasons only after access and moderation checks. Never disclose owner settings to visitors.
- Reuse the existing first status slot for network failures. Use translated guidance for unavailable owners.
- Keep a stable element inside each media `ClientOnly` slot. The browser reproduced a detached Vue fragment during the bar-to-expanded transition. Stable parents prevent that rendering failure.
- Preserve ready private snapshots when Labs is disabled. Do not reopen immutable fork acquisition.

## Risks / Trade-offs

- Shared response defaults affect other JSON controllers. Test explicit overrides and HTML responses.
- Missing source data cannot be reconstructed by status polling. Guide the owner to save the source again; do not mutate content on a visitor request.
- Production returned unavailable anonymously. Owner settings and job records remain unverified without an authenticated session.

## Migration Plan

No migration is needed. Deploy the API and Web changes through normal branch promotion. The optional field allows either deployment order. Revert the task commit to roll back.

## Transcript reading layout

The saved HTML uses one paragraph element for every short caption cue. This causes fragmented reading even when capture succeeds.
The Web processor will mark paragraph boundaries without replacing or moving cue nodes. CSS will flow adjacent cue text continuously.
Sentence endings, explicit speaker changes, and pauses determine boundaries. Long runs receive a bounded paragraph break.
Only paragraph-start timestamps remain visible and focusable. The detailed transcript panel retains every cue.
This preserves stored highlight selectors and text offsets. No source rewrite, capture rerun, or generation request is needed.
The check must use the reported production body in the running local application and verify real text, layout, seeking, and highlight paths.
Screenshots will identify the local build and real saved content. They will not imply production deployment.

## Edited YouTube articles

New generation uses a versioned editing stage followed by translation when required.
Reuse the existing structured article, caption references, object storage, workflow retries, leases, and cost limits.
Cache each stage separately. Carry the previous edited section into the next chunk as context.
Translate each edited chunk without changing its paragraph references or section structure.
Generate the introduction from all final sections. Reject omitted caption references before publication.
These checks detect structural loss; they do not establish semantic fidelity alone.

The saved article has an introduction label, contents links, topic headings, full paragraphs, and method notes.
Use Reader tokens in light, dark, and e-ink themes. Keep timestamps secondary and keyboard accessible.
Do not rewrite previously annotated bodies. The separate article view uses the same reading structure.
Generation switches control new work, not access to already published articles.
A body publication failure retains canonical content and returns an explicit incomplete outcome.
