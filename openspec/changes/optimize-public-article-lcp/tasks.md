# Tasks

Planning artifacts are complete only after validation; checkboxes below track completed work; multi-condition implementation and field tasks remain pending until their stated evidence exists. Follow [the implementation plan](../../../docs/superpowers/plans/2026-11-11-optimize-public-article-lcp.md).

## 1. Baseline and measurement

- [ ] 1.1 Freeze manually classified podcast/X long-form cohorts with both canaries after confirming per-path Cloudflare count retrieval; capture build, explicit report filters, cache states, actual LCP elements, cold/warm traces and controls; verify `validation.md` distinguishes report sampling/estimation, lab and compression-probe evidence.
- [ ] 1.2 Add narrowly scoped stage timings for access, metadata substeps, R2, projection and cache validation; verify focused tests preserve response/access behavior and diagnostic output contains no credentials or article content.

## 2. Image correctness and lean browser response

- [x] 2.1 Implement configured signed-proxy reuse with mode preservation and tests for ordinary/RSS inputs, repeated processing, foreign/unsupported shapes and existing signatures; verify API image-proxy tests and actual browser image completion.
- [ ] 2.2 Implement the authorized Web body projection for the embedded manifest and known nested sources; verify initial HTML, restored hydration, client refresh, visible/anchor identity, storage immutability, subtitle/translation/fork behavior and the podcast byte budget.
- [x] 2.3 Retain the existing public cache key and 600-second TTL; verify fresh/warmed responses and document format convergence while revocation/privacy/moderation and credential isolation remain intact.

## 3. Document latency

- [ ] 3.1 Compare owner/share parallel reads against serial access with realistic latency and the full access decision table; retain the change only with unchanged metadata/revision bytes and measured whole-request improvement.
- [x] 3.2 Record rejection of stale-hit metadata reuse: a true miss already fetches once and sharing metadata across the Nitro render boundary requires extra transport outside this minimal change.

## 4. Podcast media and client critical path

- [ ] 4.1 Preserve audio `preload="none"` for supplied positive duration through player upgrade, retain existing metadata preload for unknown duration, and preserve synchronous gesture-authorized playback with correct pre-metadata resume/seek state; verify no transfer before intent, one-gesture pre-metadata seeking on real iOS, play/pause, resume, rate and media-session behavior.
- [ ] 4.2 Prepare local evidence for Rocket Loader on/off or targeted-exclusion comparisons; remote zone changes require separate authorization. Run comparisons only when available, measuring CSS/boot readiness and LCP; retain an exclusion only with repeatable benefit and no theme/startup regression, otherwise record the rejection.
- [ ] 4.3 Profile processors, annotation drawing and player replacement; implement only the measured blocking work selected by the design, and verify unchanged reading order, anchors, find-in-page, highlights/comments, accessibility, responsive layouts, INP and CLS.

## 5. Integration and delivery

- [x] 5.1 Run focused/full affected checks, actual Worker/browser smoke, restored-image and media/translation/fork scenarios, paired timing and payload comparisons, and strict OpenSpec validation; record results and remaining agent-executable verification gaps.
- [ ] 5.2 Determine affected shipped applications, ask required version questions, complete human hands-on acceptance before opening the task PR, and close all Important Bugs/Security/Compliance review findings; verify the PR evidence links and `OpenSpec: optimize-public-article-lcp` line.

## 6. Authorized release and outcome

- [ ] 6.1 Gate the final target candidate on controlled end-to-end LCP at most 2,300 ms, identifying any earlier correctness/byte-only release as intermediate; after human-controlled deployment verify build/cache/assets/rollback convergence and record the final observation window start.
- [ ] 6.2 Observe seven complete converged-build days with at least 200 reported LCP counts per family and 100 per canary; verify raw and matched-mix rates reach 70% for both families and reported canaries, report estimation limits, and keep any missing/unjudged/unmatchable result inconclusive or failing result open.

## Current implementation state

The first proxy/projection/player batch is implemented and locally exercised; see `validation.md` for exact automated and running Worker/Chrome evidence. Multi-condition tasks remain unchecked where integrated live flows, real iOS, delivered compression, controlled LCP traces, human acceptance or post-release data are outstanding. Conditional metadata/client optimizations are not silently bundled without the required measurements. No deployment or 70% outcome is claimed.

The user explicitly requested an early draft PR on 2026-11-11 after pending human acceptance was disclosed. Task 5.2 remains unchecked; opening the draft is not acceptance or evidence that the 70% target is reached.
