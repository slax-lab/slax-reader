# Stabilize audio player layout and attribute content waits

## Why

The November 20 investigation reproduced the audio-player enhancement moving the article container by about 80px, followed by an empty podcast status section adding 16px. The new Shadow Blade Zero podcast also retains slow LCP. Test-only no-database probes localized another delay before Worker handler entry; existing production requests have no structured timing summary to correlate that boundary with platform events.

## What Changes

- Reserve the audio player's existing resting height in the snapshot reader before enhancement, keeping the native fallback usable and the enhanced sticky player outside the annotation root.
- Remove the empty podcast status section's bottom margin while retaining its live region and nonempty states.
- Log entry and response summaries for article metadata GET requests at the existing Edge and Core boundaries. Reuse the existing timing stages and platform Ray ID; identify observed module reuse without claiming a provider-issued isolate or measuring platform queues in JavaScript.

## Scope

Web snapshot CSS, PodcastBar spacing and the API content entry/handler own these corrections. No stored snapshot, cue data, media processing order, access decision, query, cache policy, Worker deployment/configuration, dependency or shared package changes are included. Desktop contents/side-panel auto-opening is a separately observed layout mechanism and is not changed here. Backend logs contain only fixed numeric phases, response status and diagnostic correlation/lifecycle identifiers; no content, SQL, tokens or user identity. Production response headers remain unchanged.

The podcast/Mole LCP Good target remains 70%; local geometry and interaction checks do not establish that field outcome. Earlier merged LCP changes retain their own outstanding acceptance tasks. This change uses distinct audio-layout and content-request-diagnostics capabilities rather than editing their delta specs.

## Approval and delivery

On November 20, 2026, after reviewing the investigation, the requester instructed implementation of audio initial occupancy, empty status spacing and useful backend logs in a fresh branch/worktree, preserving architecture/naming and highlight, image-preview, play/seek/resume behavior, followed by a draft PR. The CSS mechanism and bounded logging fields are implementation choices under that approved scope. This is a local correction within the existing approved UI pattern, exempt from the optional material-UX demo under DESIGN.md §10.1. Human hands-on acceptance under §10.2 remains required before opening the PR. Web/API changes do not use package-version increments.
