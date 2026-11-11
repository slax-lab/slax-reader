# Validation: public article LCP

## Scope and state

Implementation reviewed on 2026-11-11. Branch `perf/optimize-public-article-lcp` starts from `origin/dev` in the isolated managed worktree. The original checkout's unrelated edits are untouched.

This is the first confirmed correctness/byte batch, not a verified 70% field outcome or a final target candidate. No deployment, database mutation or Rocket Loader setting change has occurred. The task owner confirmed personal hands-on testing on 2026-11-11; see the acceptance record below. The PR was initially opened early at the user's explicit request and is now ready for review. The early-opening instruction and the later testing confirmation are separate records; no general Draft exception is claimed.

Production changes stay in four existing responsibilities: API image signing (`imager.ts`), one Web server body projection utility, the authorized `loadContent` boundary, and the existing podcast component. Unknown/zero-duration episodes retain metadata preload; supplied-duration episodes use no preload. No shared-package export, cross-app import, runtime dependency, migration, cache namespace, new transport, or new playback state machine was introduced. Web/API do not increment package versions under `docs/release/VERSIONING.md`; no CLI, Extension, or Mobile package/build/contract was changed.

## Review corrections

- True anonymous cache misses fetch metadata once. A stale cached revision can fetch twice across middleware/render boundaries. Reject the cross-render metadata handoff; its new transport is outside this minimal implementation. Cost: the existing stale-hit duplicate remains.
- Keep the existing ten-minute cache TTL and key. Old presentation may persist for up to 600 seconds after deployment/rollback, with fresh authorization/revision validation still required. Wait for expiry before assessing convergence.
- Reuse only a verified configured proxy with the same signing mode, preserving its original URL bytes. Mode mismatches continue through the existing signer; the endpoint's signature, Referer, public-target, Range, RSS limits and redirect behavior are unchanged.
- Real workerd confirmed `HTMLRewriter.getAttribute()` returns serialized attribute text (`&amp;` included). Projection decodes ampersand references before interpreting URLs and escapes them when writing the selected inner URL.
- With no preload, the saved position must be available before metadata. Calling the existing metadata/restore handler on mount sets the default playback start and progress display without loading the media for known-duration episodes. Failing regression tests also proved the need to recheck saved progress when actual duration arrives and suppress the pre-metadata playing-position broadcast; explicit seeks still win. Source emits zero duration when provider duration is missing, so those episodes retain metadata preload instead of losing pre-playback progress controls. Existing synchronous seek/play and explicit-seek precedence remain. Chrome verified this without new pending-seek state; real iOS remains a gap.
- Captured Mole markup contains two videos and no video posters. Only the observed `img[src]` nesting is repaired; video/source attributes retain current behavior.

## Baseline evidence and outcome denominator

Cloudflare Web Analytics was inspected on 2026-11-11 (GMT+8, preceding three days, bots excluded, host `r.slax.com`). Percentages below are report-rounded, and counts are Cloudflare-reported LCP observations, not unique users or unsampled requests.

| Manually classified canary | Path | Reported count | Good | LCP P75 | TTFB P75 |
| --- | --- | ---: | ---: | ---: | ---: |
| Podcast, audio and timed transcript | `/b/ea02a6ad-22e9-49ec-bd63-1fb22bf98f75` | 368 | 23% | 5,068 ms | 3,240 ms |
| Mole X long-form, text/images/video | `/b/a3b123af-27fc-4d12-b329-d8c4fd26b3f6` | 121 | 26% | 6,010 ms | 3,306 ms |
| Collection control, outside target denominator | `/c/285f4c1b08ba3f4508d31d1f6b146e37` | 222 | 82% | 1,808 ms | 1,634 ms |

The initial canary manifest is these two `/b` paths; a broader frozen family manifest, exact bucket counts/date bounds and matched-mix extraction are not complete. Do not calculate exact Good counts from rounded rates. Final collection uses explicit identical GMT+8 date bounds, host/path equality and bots excluded per manifest URL to avoid the top-15 truncation. Hard/soft navigation and authentication splits are lab-only because the field report does not expose them. Marginal P75 subparts are not additive. No field cache-hit ratio is inferred from RUM counts.

## Automated checks

All commands run in the task worktree. Synthetic process environment values from `docs/web/development.md` were used for Web preparation/typecheck; no secret files were read/copied. Fresh API setup used `SLAX_API_SKIP_DOTENV=1` and synthetic PostgreSQL URLs for `gen:model`; generation does not connect to or migrate a database.

| Check | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | Pass, lockfile unchanged |
| `pnpm web -- type` | Pass with documented placeholder environment |
| `pnpm api -- gen:model` | Pass; only local ignored clients generated |
| `pnpm api -- test test/utils/imageProxyReuse.test.ts test/handler/http/imageProxy.test.ts` | 61 passed; new reuse tests first failed on four double-wrapping cases |
| `pnpm web -- test tests/unit/server/contentSession.spec.ts tests/unit/server/shareCacheIsolation.spec.ts tests/unit/components/Article/CEComponents/PodcastPlayer.spec.ts tests/unit/components/Article/processors/podcast.processor.spec.ts tests/unit/server/pdfContent.spec.ts` | 64 passed in the final expanded focused run |
| `pnpm web -- test tests/unit/server/shareCacheIsolation.spec.ts tests/unit/server/contentSession.spec.ts` | 32 passed, including added fresh/warm revision, denial, TTL/key and diagnostic-policy cases |
| `pnpm web -- test --maxWorkers=4` | 232 files passed, 1 skipped; 2,742 tests passed, 3 skipped |
| `pnpm api -- test --maxWorkers=4` | 245 files passed, 15 skipped; 3,863 tests passed, 118 skipped |
| `pnpm web -- build` | Pass with the documented synthetic development configuration; no upload |
| `pnpm api -- build` | All four offline bundles passed using the public example config and existing `--dry-run` wrapper; dotenv disabled |
| `pnpm web -- typecheck` | Pass; caught and corrected a Worker handler return type before completion |
| `pnpm api -- typecheck` | Pass after generating local Prisma clients |
| Changed production file ESLint in Web/API | Pass |
| `node apps/web/tests/fixtures/article-loading/web-body-projection.mjs /tmp/slax-lcp-20261111` | Pass in real Miniflare/workerd; exact script selector, visible text/anchors/cues/media, modes, signed bytes, entities, unsupported sources and idempotence |
| `pnpm exec openspec validate --all --strict` | 124 passed, 0 failed |

Initial full API checks failed because a fresh install lacks custom Prisma clients; configured generation resolved the imports and both checks passed. The first Web test run required Nuxt preparation. These setup failures did not lead to source/dependency/configuration changes. Existing full-suite skips remain skips; they are not passing coverage.

Authorization boundary tests ensure denied metadata never reads R2 or invokes projection; successful metadata selects the canonical key, the Web endpoint is derived from public API config, and projection exceptions propagate instead of being swallowed as R2 failures. Existing PDF behavior remains outside the projection.

## Running Worker/browser evidence

Real Worker contract checks run through Wrangler's bundled Miniflare, without a mocked HTMLRewriter. Browser fixtures run the production projection, existing SSR processors/loading policy, stripped-body restoration and real Vue hydration. The podcast fixture compiles the actual custom element and serves native PCM audio with Range support; it does not mock browser playback.

Chrome 157 on macOS, 2026-11-11:

- Projection fixture: first repaired image loaded at natural width 800; only the inner image URL was requested. SSR/hydration/refresh candidates and eager sources matched, image nodes were retained, manifest was absent, and no hydration warnings occurred.
- Podcast before intent: `preload=none`, `readyState=0`, current/default start 30 seconds, displayed progress `0:30`, supplied duration `1:30`, zero audio requests.
- One chapter click: first playing broadcasts were at 45 seconds, followed by actual progressing playback; no zero-position playback broadcast or second gesture. Metadata did not override the explicit chapter position.
- Skip before metadata: 30 → 45 seconds while `readyState=0` and audio requests remained zero; first play started at 45 seconds. Pause and 1.25× speed worked without an error state.
- Actual-duration mismatch: supplied duration 3,600 seconds with saved position 300 seconds versus native duration 90 seconds reset playback to 0 before a playing-position broadcast. A separate early explicit 45-second chapter seek retained 45 seconds despite the same mismatch. Unknown-duration input retained metadata loading, ready duration/progress and paused state.
- Responsive/theme fixture checks passed at 390/768/1440 px in light/dark/e-ink: player bounds stayed within the viewport and saved progress remained visible. Screenshots are local, uncommitted artifacts (`/tmp/slax-lcp-implementation-20261111/podcast-390-light.jpg` and `projected-image.jpg`). These are synthetic correctness checks, not throttled production LCP measurements.

Run the reviewable fixtures locally with:

```sh
node apps/web/tests/fixtures/article-loading/browser-harness.mjs
node apps/web/tests/fixtures/article-loading/podcast-browser-harness.mjs
```

Open `http://127.0.0.1:4318/?fixture=projection.html` and `http://127.0.0.1:4319/?case=manual-review`.

## Byte evidence

Paired gzip level 6 over the identical anonymous captured HTML through real workerd:

| Capture | Before | After | Reduction |
| --- | ---: | ---: | ---: |
| Podcast | 287,652 bytes | 131,423 bytes (128.3 KiB) | 54.31% |
| Mole | 34,654 bytes | 34,135 bytes | 1.50% |

The podcast passes the local paired-compression target (at least 40%, at most 150 KiB); this is not delivered CDN compression evidence. The original stored bodies are never written by this Web utility. The API snapshot/fork/translation code remains unchanged and its relevant tests are included in the full passing API suite. Source discovery found the embedded manifest's consumers in API snapshot utilities, with no Web runtime reader; same-origin `/api/content/` callers are Web page code/verification fixtures.

## Conditional candidates and verification gaps

- Owner/share parallel reads remain unimplemented: no paired whole-request production/database timing demonstrates their current impact. Existing repository ordering/access decisions are preserved. Added projection timing follows the existing non-production diagnostic policy; no broad timing instrumentation or user/article data logging is added.
- Rocket Loader exclusion, annotation/processor deferral and offscreen rendering remain unimplemented: no repeatable controlled trace justifies changing them. No PowerSync route contract is expanded.
- Full integrated app smoke with authenticated save/fork/translation generation, subtitle panel interactions, highlights/comments, original-image preview and real Safari/iOS has not been exercised on this branch: the worktree has no operator-provided API/auth runtime or physical iOS device. Automated source/contract coverage and synthetic browser checks do not substitute for those flows. Keep these gaps explicit for human review.
- Real reported-image browser recovery against the deployed new Web build, actual delivered compression, real edge-cache overlap, CPU profiles, twenty throttled timing pairs and end-to-end LCP budgets remain pending because this branch has not been deployed. Local fixture results do not establish those measurements.
- No post-release seven-day cohort observation exists. The 70% goal remains open; do not infer attainment or a guaranteed LCP saving from payload reduction or synthetic playback.
- Human hands-on acceptance was confirmed directly by the task owner on 2026-11-11, after the documented task-specific early-PR instruction. The acceptance record below does not infer unreported environments or individual test steps.

## Local final review

Independent Claude Code review requested `claude-opus-5-5`, with a curated read-only packet and tools disabled, returned no Important findings. Codex verified each Nit and each declined-to-judge behavior against source; this review is not a substitute for running verification or human acceptance.

- Regraded and fixed: computing the proxy endpoint before the Worker check broke the documented Node original-body profile with unset API base. A failing test reproduced it; endpoint derivation now stays inside the projection utility after that check.
- Regraded and fixed: a missing duration is a real supported producer output (`durationSec ?? 0`), so a metadata-preload exception preserves existing progress/duration behavior. A failing regression test covers it.
- Codex review also reproduced stale saved progress surviving a shorter actual duration; a failing test covers the correction without adding seek state.
- Security boundary check: real workerd serializer tests prove literal quotes in an inner URL remain inside `src` and cannot become an `onerror` attribute. No new escaping framework was added.
- Evidence placeholders/counts are reconciled by final verification below. The PDF fixture's unrelated config addition was removed when endpoint derivation moved.
- The canonical writer appends the manifest after existing visible body nodes; selection rendering skips SCRIPT/STYLE/NOSCRIPT. Full integrated highlight/comment acceptance remains a declared gap.
- The `/b` page uses `useRequestFetch('/api/content/<uuid>')`; that route invokes `loadContent`, so SSR and refresh share the projection. Fork submits the source URL, and API snapshot/media services read canonical R2.
- Query duplicate semantics were inspected: the endpoint uses the last query occurrence; generated proxy URLs have unique signed fields. Endpoint revalidation remains authoritative; unsupported supplied URLs cannot widen access.
- Derived endpoint matching is verified for the captured public runtime API base; custom operator proxy paths outside `/static/image` are not guessed by this Web repair.

Remaining release/field tasks stay unchecked. Real iOS and the specific agent-executable gaps above remain open. Human hands-on testing was subsequently confirmed by the task owner; this does not establish field LCP attainment.

Final local outcome: 64 focused Web tests, 2,742 full Web tests and 3,863 full API tests passed; final Web/API typechecks, changed production lint, Worker projection checks and API offline bundle passed. Final Web rebuild passed (exit 0) after the fix pass; final strict OpenSpec validation passed all 124 items. The complete 70% outcome is still open.

Codex completed the post-fix Bugs/Security/Compliance review against this change and the staged scope: no unresolved Important findings and no deferred Nits. Human acceptance is recorded separately below. Real iOS/integrated runtime gaps and field outcome remain visible above; local correctness/byte delivery does not close those gaps.

## PR delivery instruction

On 2026-11-11 the user explicitly asked to submit the PR first, after the missing human acceptance and field verification were disclosed. The PR was opened as an early draft targeting `dev`, with acceptance pending at that time. It was subsequently made ready for review. Preserve this chronology and the existing agent-verification gaps. This documentation-only status update does not change the verified production code; the full-suite counts above apply to implementation commit `e491d9fb`.

PR visual evidence was captured at 390 x 844 CSS pixels, light theme, in the same synthetic nested-image fixture: baseline `6016ee48` delivery retained the outer source and the image completed with natural width 0; current delivery selected the inner source and completed with natural width 800. Baseline source was read with `git show origin/dev:.../browser-harness.mjs` into ignored scratch space. Both screenshots are attachments, not committed files. This does not claim production canary recovery or field LCP evidence.

## Human hands-on acceptance

- Confirmation date: 2026-11-11, Asia/Shanghai.
- Acceptance owner: the task owner and PR author, @Whyjsee, reporting directly in this conversation.
- Reported scope and result: the owner confirmed they had personally tested the current change. In the context of clearing the pending acceptance item, this confirms acceptance of the current functional changes; no further adjustments were requested.
- Visual evidence: the owner supplied no additional screenshots because the change does not redesign the interface. Existing agent-produced before/after attachments remain synthetic image-correctness evidence, separate from the human report. No human screenshot is claimed.
- Reporting limits: the owner did not specify the exact runtime or individual steps. The record does not infer a real-iOS pass, every authenticated flow, delivered compression or the 70% field outcome.
- Chronology: the user previously requested opening the PR first, explicitly authorizing that task-specific ordering exception. This later personal-testing confirmation supplies the acceptance record; it is not retroactively dated before PR creation.

## Nested image proxy explanation

The first captured Mole image is `https://pbs.twimg.com/media/HWqmqkVasAAybYB.png`. All 11 proxied images in the captured article have an extra proxy wrapper. Let `P(url)` mean the configured signed Slax image endpoint:

| Input/state | Generation or Web-delivery result |
| --- | --- |
| New original image URL | Generate `P(original)` with `u`, `r` and `d` |
| Already valid same-mode `P(original)` | Reuse the complete supplied URL byte-for-byte, including its existing `r` and `d` |
| Already valid same-mode `P(P(original))` passed to generation | Reuse it without adding a third layer; Web recovery handles the supported historical double wrapper |
| Authorized stored HTML with the known double wrapper | Return `img[src]=P(original)` in SSR/content refresh; canonical R2 HTML remains unchanged |

The browser still requests the Slax proxy, not the original image origin. The proxy continues to apply its signature, incoming Reader Referer and public-target checks, then supplies the upstream Referer from the preserved `r` under existing rules. Removing the extra outer wrapper does not remove this source-site compatibility behavior.

For the captured example, the outer layer forwards the original X article Referer when requesting the inner Slax endpoint. That is rejected by the inner endpoint's Reader-origin check. On 2026-11-11 the same inner URL returned 200 `image/png` (18,323 bytes) with a Reader Referer and 403 with the X article Referer; the outer URL returned 302 to `notfound.png`. This diagnoses the extra hop and its failed source check, not a guaranteed LCP saving. New Web renders/refreshes apply the bounded repair; existing public HTML may retain the old format for the unchanged 600-second TTL.

## PR review response

Review run `42950009646` found one Important Compliance item: the missing human-acceptance record and stale Draft description. The direct owner confirmation above resolves the record; the PR description is synchronized with its current non-draft status. Web/API/configuration and the other application CI gates on `1f62c2ff` passed. No production-code change is required to correct this evidence failure.

Three non-blocking Nits were examined against the original minimal-scope instruction:

- Keep Web recovery bounded to the observed `/static/image` endpoint derived from the public API base. Custom operator paths remain a disclosed limitation; a shared configuration abstraction is not introduced without a concrete required deployment.
- Generated signed URLs contain each signed field once (`URLSearchParams.set`). First/last duplicate-query differences concern unsupported supplied URLs; the endpoint still revalidates the effective signature and cannot grant extra access. No new compatibility parser is added for this input class.
- Preserve the tested propagation of projection errors. The storage-read recovery and projection have different failure contracts; no blanket catch hides rewriter/programming errors. The explicit Node profile without HTMLRewriter retains its existing original-body behavior.

This follow-up updates documentation/evidence only. Existing implementation checks apply to unchanged production code; strict OpenSpec validation is rerun before pushing.
