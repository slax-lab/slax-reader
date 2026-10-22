# Web LCP baseline for `optimize-web-lcp`

Status: implementation evidence record. The measurements below are not a production enablement decision.

## Scope and source revision

- Change: `optimize-web-lcp`
- Worktree branch: `perf/optimize-web-lcp`
- Planning/base revision: `4d051b70bea408b30a9e05fa8ee51270bd76502a`
- Baseline capture date: 2026-10-20 (Asia/Shanghai)
- Cloudflare report reference: `r.slax.com`, bot exclusion enabled, 30-day window, GMT+8
- The deployed revision represented by the historical report has not yet been matched to this source revision.

## Historical observations from the reviewed report

These values are copied as hypotheses from the planning review. They are not new measurements from this branch.

| Route/sample | LCP P75 | Main reported subpart | Count | Interpretation status |
| --- | ---: | --- | ---: | --- |
| Overall | ~3,340 ms | 62% good / 21% needs improvement / 17% poor | — | Historical outcome |
| `/b/ae51225c-840a-4b39-8fdf-2636dea962ea` | 6,508 ms | Image request delay 2,482 ms; load 1,996 ms | 400 | Request discovery hypothesis |
| `/b/b40a8cd1-d9c1-4de5-93b9-ffdec5ae1a98` | 7,648 ms | TTFB 3,721 ms; image delay 1,291 ms; render delay 2,291 ms | 110 | Mixed bottleneck hypothesis |
| `/b/aa181615-53fb-4f6b-a08f-d477537e230b` | 7,504 ms | Tweet image load 3,033 ms | 50 | Transfer/cache hypothesis |
| `/login` | 5,300 ms | Logo request delay 3,390 ms; download 234 ms | 120 | Startup hypothesis |
| `/guide` | 48,432 ms | Third image request delay 11,887 ms; load 33,153 ms | 30 | Low-count tail; requires reproduction |
| `/bookmarks` | — | Promo image request delay 3,657 ms; download 3 ms | 40 | Conditional-rendering hypothesis |

## Measurement matrix

The following rows are required before either switch is enabled. Five interleaved runs provide a median and range; twenty or more runs are required when a small difference is being used as evidence.

| Condition | Routes/controls | Device/network/cache | Status |
| --- | --- | --- | --- |
| Anonymous public | `/login`, `/guide` with campaign query and fragment | Mobile + desktop; cold/warm browser cache; service worker state recorded | Pending real-browser trace |
| Authenticated normal | `/`, `/bookmarks`, authenticated guide | Mobile + desktop; cold/warm browser cache | Pending real-browser trace |
| Article | Normal, WeChat, tweet/social, text-heavy `/b/**` and `/s/**` | 390/768/1440 CSS px; mobile/desktop; cold/warm browser cache | Pending real-browser trace |
| Bridge | `/x/ext-bridge` | Extension bridge fixture and storage-denied control | Pending real-browser trace |
| Switch matrix | Pre-change, `off/off`, `on/off`, `off/on`, `on/on` | Same build identity and browser profile per interleaved group | Pending implementation build |

## Evidence to record per run

- Deployed and test build identity, exact UTC and GMT+8 timestamps, host/bot filters, browser version, viewport, device emulation, network profile, browser cache state, and service-worker state.
- Initial document versus SPA entry, response HTML identity, selected LCP element, request start/initiator/priority, image download duration, render delay, document TTFB, CLS, long tasks, and interaction traces.
- Plugin completion, app mount, first local-query timing, and whether public startup constructed or initialized a database.
- For article fixtures, candidate identity, loading/fetch-priority attributes, signed URL preservation, browser-restored `innerHTML`, hydration replacement count, and responsive-source request count.

## Current implementation evidence

The implementation verification below is synthetic and local; it does not establish a Core Web Vitals improvement.

- `pnpm web -- test --maxWorkers=2`: 212 test files passed, 2,369 tests passed; 3 tests skipped (one file skipped). A Happy DOM fetch teardown emitted an `AbortError` after the passing run; the command exited zero and no test assertion failed.
- `pnpm web -- typecheck`: passed with synthetic public environment values.
- `pnpm web -- build`: passed with a synthetic beta build configuration. The article route entry/preload/static-import closure grew by 30,019 gzip bytes and 24,773 Brotli bytes versus the committed baseline build, below the 50 KiB gzip ceiling. The measurement is from `tests/fixtures/article-loading/bundle-budget.mjs` and includes route-associated CSS. The probe accepts both the older compact Nuxt route syntax and the current formatted `__vitePreload` output.
- Fixed 100,000-byte/100-image transform benchmark: independent runs reported median 2.286–2.504 ms and p95 2.716–3.292 ms on Node 24.15.0 arm64, below the 10 ms gate.
- Browser fixture harness: 14 synthetic article fixtures passed in Chrome 154. It compared the initial browser-parsed candidate, a reparsed body, and a refreshed body; source identity and DOM-node identity remained stable. Resource entries were only the local synthetic fixture images. This is a mechanism check, not a production LCP trace.
- Public-startup browser fixture: anonymous `/login` and `/guide` documents bypassed the database boundary in the adapter, and leaving `/login` used one full-document navigation preserving query/hash. A separate back-navigation attempt did not produce `pageshow.persisted === true`; BFCache eligibility and the real OAuth/account-switch flows remain unverified.

No production-like Cloudflare cache drill, deployed-build match, field cohort, or 7-day observation has been run. A successful unit test or local build does not establish a Core Web Vitals improvement.

## Reproduction commands

Commands used for committed evidence will be added below with their toolchain versions and output paths. Raw traces containing article content, account identifiers, URLs, or tokens must remain outside the repository.

```text
node apps/web/tests/fixtures/article-loading/benchmark.mjs
node apps/web/tests/fixtures/article-loading/bundle-budget.mjs .superpowers/sdd/2026-10-19-optimize-web-lcp/baseline-dist apps/web/dist
node apps/web/tests/fixtures/article-loading/browser-harness.mjs
node apps/web/tests/fixtures/article-loading/public-startup-browser.mjs
```
