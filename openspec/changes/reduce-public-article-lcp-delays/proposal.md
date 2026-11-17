# Proposal

## Why

The seven-URL investigation found that document first-byte delay remains a major constraint on podcast LCP, while the edited YouTube player's server fallback and client replacement occupy different boxes. PR #605 is now deployed to production, but its node retention and image-cache changes do not remove those costs; the change requester retains the podcast/Mole family target of at least 70% LCP Good.

## What Changes

- Establish the post-#605 baseline with its existing non-production timings, distinguishing normal article requests from missing test data and deployment verification from production field outcomes.
- Make the saved edited-YouTube player's initial Web fallback occupy the same effective box as its current enhanced player, preserving the final appearance and existing article/media lifecycle. Apply this at the Web presentation boundary so old saved bodies benefit without recapture.
- Attribute the remaining first-byte delay using the existing Web/Edge/Core timings on successful requests. Owner and share reads share a request-scoped database pool configured with `max: 1`; a Promise-only overlap is not selected for implementation.
- Preserve all #605 behavior, complete saved text, highlight selectors, image previews, native fallback, chapter seeking, podcast playback and refresh/resume.

The runtime implementation scope is player-box stabilization. First-byte work in this proposal is measurement only; database scheduling, connection-pool size and deployment placement remain unchanged. Removing duplicate YouTube iframe initialization, CSS/module splitting, image transformation and historical snapshot repair are outside this proposal.

The change requester initially deferred the missing-sample #605 verification, then reported production deployment on November 16, 2026 and resumed verification. Serving-build, cache, resource and selected interaction results are recorded in `validation.md`; controlled-profile, node-identity and field-acceptance gaps remain incomplete. They separately approved implementation of the initial player-layout stabilization slice, preserving the architecture and minimizing changes, with highlight, preview, playback, seeking and resume regressions checked.

The requester subsequently resumed first-byte attribution and authorized a necessary, demonstrated minimal optimization in the open #624. Existing public test articles were discovered through the test site's published collection sitemap. Successful Web/Edge/Core measurements and temporary tail observations now identify substantial wait outside the measured Core handler on slow requests; they do not establish its exact platform/startup cause or a safe query/placement correction. This pass records the results without expanding the runtime diff. The different test articles do not close same-content podcast/Mole or field-acceptance gaps.

The November 17 continuation obtained an exact native trace using the matching client Ray ID, after requester-authorized temporary test-only tracing. It confirms same-HKG linked calls and large pre-operation prefixes, while cold initialization versus platform scheduling remains unproven. Both tracing switches were restored disabled. Next-morning field results, new leading URLs, sample counts and the incomplete 70% outcome are recorded separately in validation.md. This remains an evidence-only continuation of first-byte work, with no additional runtime patch.

A further requester-authorized November 17 experiment temporarily wrapped the existing deployed test modules with a module-instance nonce and observed-handler counter. Forty successful content requests across two bounded passes distinguish first observed calls from reuse, and a matched native trace locates the large first-call prefixes before the Edge/Core handler-entry logs. Cloudflare upload validation reports startup times of 402ms/441ms for the diagnostic Edge/Core versions; those validation measurements are not per-request serving startup spans. First-use overhead is now demonstrated in this experiment, but its initialization-versus-platform-loading/scheduling split remains unavailable. Original test versions, binding names/types and observability settings were restored and verified, including disabled Traces. No temporary wrapper, configuration or additional runtime fix is included in this PR.

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
- The approved runtime implementation covers player-layout stabilization and its verification. The change requester subsequently asked to finish the previously planned non-#605 work, review it, and create a draft pull request targeting `dev`. Production verification was later resumed separately and does not establish successful metadata-stage attribution or field acceptance. Human hands-on acceptance remains required before opening the behavior pull request.

## Human hands-on acceptance

On November 16, 2026, the change requester confirmed personally testing the implemented change in the local browser at `http://127.0.0.1:4323/?live=1&theme=light`: initial player layout, stable article position after selecting Enhance player, and playback/chapter seeking via the 1:05 control were normal. No further adjustments were requested. This acceptance applies to this follow-up's initial player presentation; it is separate from #605 acceptance and does not certify deployed performance or real-device parity.
