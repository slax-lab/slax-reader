# Proposal

## Why

The seven-URL investigation found that document first-byte delay remains a major constraint on podcast LCP, while the edited YouTube player's server fallback and client replacement occupy different boxes. PR #605 is now merged into `dev`, but its node retention and image-cache changes do not remove those costs; the change requester retains the podcast/Mole family target of at least 70% LCP Good.

## What Changes

- Establish the post-#605 baseline with its existing non-production timings, distinguishing normal article requests from missing test data and deployment verification from production field outcomes.
- Make the saved edited-YouTube player's initial Web fallback occupy the same effective box as its current enhanced player, preserving the final appearance and existing article/media lifecycle. Apply this at the Web presentation boundary so old saved bodies benefit without recapture.
- Attribute the remaining first-byte delay using the existing Web/Edge/Core timings on successful requests. Owner and share reads share a request-scoped database pool configured with `max: 1`; a Promise-only overlap is not selected for implementation.
- Preserve all #605 behavior, complete saved text, highlight selectors, image previews, native fallback, chapter seeking, podcast playback and refresh/resume.

The runtime implementation scope is player-box stabilization. First-byte work in this proposal is measurement only; database scheduling, connection-pool size and deployment placement remain unchanged. Removing duplicate YouTube iframe initialization, CSS/module splitting, image transformation and historical snapshot repair are outside this proposal.

The change requester has deferred the missing-sample #605 verification until they notify production deployment. This remains an incomplete TODO. On November 16, 2026, they separately approved implementation of the initial player-layout stabilization slice, preserving the architecture and minimizing changes, with highlight, preview, playback, seeking and resume regressions checked.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `youtube-ai-article`: require a stable initial-to-enhanced player box for saved edited articles, with the existing final player presentation and reading interactions preserved.

The first-byte measurements preserve the existing snapshot and public-delivery requirements. They do not create a competing `public-article-delivery` delta while the merged #564/#605 changes await their separate archival workflow.

## Impact

- Expected Web runtime edit: the existing article stylesheet, with focused geometry/interaction evidence. Existing `YoutubeProcessor` and `YoutubePlayer.ce.vue` define the final presentation to match; changing their lifecycle is not part of the scope.
- API/DI/repository runtime edits: none. Existing request timings supply the attribution experiment; add no layer, dependency, SQL, migration, cache, configuration switch, retry, service or connection.
- This is a sequential follow-up based on `origin/dev` merge `2203281e` after #605. Do not modify, archive or mark the predecessors' outstanding deployment/field tasks complete in this change.
- The approved runtime implementation covers player-layout stabilization and its verification. The change requester subsequently asked to finish the previously planned non-#605 work, review it, and create a draft pull request targeting `dev`. That request does not provide missing successful-request measurements or revoke the explicit production-verification deferral. Human hands-on acceptance remains required before opening the behavior pull request.

## Human hands-on acceptance

On November 16, 2026, the change requester confirmed personally testing the implemented change in the local browser at `http://127.0.0.1:4323/?live=1&theme=light`: initial player layout, stable article position after selecting Enhance player, and playback/chapter seeking via the 1:05 control were normal. No further adjustments were requested. This acceptance applies to this follow-up's initial player presentation; it is separate from #605 acceptance and does not certify deployed performance or real-device parity.
