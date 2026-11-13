# Design and implementation plan

## Evidence

A production DOM breakpoint on the short WeChat article stopped in Vue's `patchDOMProp(innerHTML)` from `hydrateElement`, with `dynamicProps=[innerHTML]` and patch flag 8. The unchanged `v-html` assignment replaces SSR descendants after async plugins finish. In a diagnostic recording, text LCP candidates appeared at 2.185s and 6.610s; the image completed at 1.144s. This is a node-replacement mechanism, not proof of a blank page until 6.610s or proof of all field delay.

Three-body offline compilation/replay reproduced one initial write under the existing binding and zero under a local directive. An earlier plain object binding experiment was rejected because compiler-ssr omitted the article body. Explicit own-SSR body presence and non-null node identity are required in tests.

## 1. Component-local HTML ownership

In `BookmarkArticle.vue`, keep the existing `.html-text` element and string-valued `articleHTML`. A local directive returns `{ innerHTML: value }` from `getSSRProps`; `beforeMount` writes only if DOM HTML differs from that value; `beforeUpdate` writes only if the value differs from `oldValue`. Keep reconciliation synchronous before the existing mounted/nextTick processor pipeline. Unrelated updates must preserve processed marks and image handlers. Different/empty initial values, fresh CSR, actual refresh/clear and keyed remount retain their existing behavior.

Do not add a global directive/plugin, a Vue patch/downgrade, a new content transport, mismatch suppression or whole-body deferral. Measure browser serialization/comparison cost and actual node identity; Happy DOM is not browser performance evidence. Preserve the current trust/sanitization boundary.

## 2. Existing request timing boundaries

Propagate the existing optional timing callback through access and metadata substeps. Record fixed stage names and numeric durations only. Do not change call order, parallelism, serialized metadata key order, error behavior or authorization. Production continues to omit diagnostic headers. Warm HTML delivery separately measures cache lookup, current revision validation and cached body reading, ending the total after body read. Preserve backend timing headers in diagnostic responses.

Existing beta spans do not locate the production slow tail. Database/query/placement changes require later same-request evidence; zero Worker timer spans do not establish zero CPU cost.

## 3. Image R2 hit

In the existing handler's eligible R2 image-success branch, clone the response and enqueue the existing Cache API write. Reuse its key, headers and policy. Signature/Referer/public-target/mode/Range validation stays before lookup. Preserve RSS byte/MIME checks, do not promote legacy video or invalid responses into image cache, and do not cache partial responses. Cache API contents are local to a data center.

## 4. Known X article cover dimensions

In the existing FxEmbed capture branch, before image URL rewriting, read the positive intrinsic width/height supplied for the exact cover source. Set the pair only when both attributes are absent, preserving authored sizing, other images, text, IDs and order. The observed raw cover is 1500x600 and cached variant 1200x480, the same ratio. Do not fetch image dimensions during SSR or infer arbitrary image sizes.

The new capture fix does not change existing snapshots. Recheck the Mole canary's CLS after the body fix; any legacy repair remains a separate revision-aware maintenance preview. Only image-induced CLS 0.09 was reproduced, not field CLS 1.798.

## Verification and delivery

Run focused failing regressions before each implementation, then affected suites/types/build and strict OpenSpec validation. Exercise real SSR hydration, highlights/selection, image previews and the actual podcast processor/player with native media in a local browser. Cover play/pause, timed paragraph jump, pre-metadata intent, saved-position precedence, refresh/resume and speed, plus true content replacement/clear and SPA/remount controls. Record real iOS, authenticated integration or production timing gaps explicitly rather than claiming coverage.

Explicit paragraph intent retains its existing precedence over a restored playback position. Fine-grained metadata timings are released only after successful metadata resolution; failed cache validation does not forward backend stages.

Retain the prior controlled profile (390x844 DPR2, 1.6Mbps down/750Kbps up/150ms configured latency/CPU4x; desktop control), five interleaved mechanism pairs and twenty for small timing decisions. Record past hydration and processor completion. LCP P75 <=2300ms is the final candidate gate; TTFB P75 <=1200ms is diagnostic. After human deployment and 600-second convergence, the existing seven-day, >=200 LCP counts per family and >=100 per primary canary, raw/matched-mix >=70% outcome contract remains required. Marginal P75 subparts cannot be added or used to prove 70% impossible.

Human hands-on acceptance under DESIGN.md section10.2 precedes any behavior PR. This task does not authorize deployment, stored-data mutation or production configuration changes.
