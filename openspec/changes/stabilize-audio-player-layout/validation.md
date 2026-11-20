# Validation — November 20, 2026

## Scope and environment

Branch `fix/stabilize-audio-player-layout`, isolated worktree based on `origin/dev` at `cabedb457`. The implementation changes only snapshot audio layout, empty PodcastBar spacing and GET `/content/meta` timing summaries. Existing player/processor/annotation/image-preview implementation, access decisions, query order, cache rules and Worker deployment configuration remain unchanged. No shared packages, migrations, dependency upgrades, credentials or new environment variables are part of this change. Web/API package versions are exempt under `docs/release/VERSIONING.md`.

## Reproduction and running browser exercise

Run `node apps/web/tests/fixtures/article-loading/audio-layout-browser-harness.mjs` from the repository root and open `http://127.0.0.1:4324/?manual=1&theme=light`. The committed fixture source-compiles the actual article CSS cascade, PodcastProcessor, PodcastPlayer custom element, PodcastBar, MarkRenderer/DwebEnvironmentAdapter, ImageProcessor and image preview. Only account/status polling, i18n and the surrounding article context are fixture boundaries. The audio is a local HTTP-range-capable 90-second silent WAV; it is intentionally silent. This is an isolated reader exercise, not a full authenticated Nuxt session.

The pre-fix exercise failed all nine light/dark/e-ink × 390/768/1440px cases: enhancement moved the article container by 80.1875px, the introduction by 26.1875px, and mounting an empty status section added another 16px. Matching fallback height alone left the 80px container displacement, motivating the flow offset while retaining the existing sibling insertion.

After the change, all nine cases passed: article-container, introduction and empty-status deltas were each 0px; original text/image nodes were retained, the player remained outside the annotation root, and the polite live region remained mounted. Browser page-error lists were empty. Local Playwright runner/results/screenshots are retained under ignored `.local/audio-layout/`; the PR recording presents the light, 768px enhancement transition. The toolbar position differs between the early baseline screenshots and final screenshots, so those whole-page images are not presented as a matched visual pair.

Interactive Chromium checks passed in light/390px, dark/768px and e-ink/1440px:

- Draw and click an actual mark using the existing annotation renderer.
- Open and close the actual image preview.
- Click the chapter's 0:45 control, then use Enter on the inline seek target; actual media plays at the requested time.
- Pause and verify position 45 is persisted; reload, enhance and play, then verify actual playback resumes at approximately 45 seconds.
- Scroll the sticky player to its existing responsive top offset: 48px on narrower layouts and 52px on desktop.
- Show a working status, then clear it: its margin changes from 16px to 0px. A translation switch retains the existing 16px spacing and polite live region.
- With page JavaScript disabled, the native audio controls remain visible and a real click starts playback; the article remains readable.
- An episode without title/show/cover retains stable geometry. A fixture 503 media response displays the existing error and the player grows beyond its resting reservation without clipping.

## Running backend exercise

A local Miniflare/Workerd exercise bundled the actual named `ContentEntry` and actual Core `handleContentRequest`/`ContentTiming`, joined by service bindings through a minimal Web proxy. Repository/domain/auth boundaries were synthetic anonymous fixtures; no SQL, deployed Worker or external article was accessed. Three requests returned 200, 200 and 404 with no production Server-Timing header. Each boundary emitted one entry and one response event per request, preserving a per-module identity and observed ordinals 1/2/3; both boundaries carried the same test Ray ID. The private fixture UUID did not appear in the timing events. Core summaries contained the existing context/infrastructure/auth/meta/serialize/cleanup/total map; Edge summaries contained core-fetch. Local runner, output and exact assertions are retained under `.local/audio-layout/api-runtime*`.

The unit coverage additionally confirms the original production Response object is returned, a rejected service binding propagates the same error after its failed timing summary, and visit requests do not emit these metadata logs. Existing revocation tests cover invalid tokens, deleted users and database failures without anonymous fallback. No timing event records URL, query/UUID, token, identity, SQL, article text or error payload.

## Automated checks

All commands below completed successfully in this worktree:

- API: `pnpm --dir apps/api exec vitest run` — 273 files / 4353 tests passed; 20 files / 166 tests skipped by the existing integration requirements. The final two Core timing assertions were also verified in the focused run below.
- API focused: `pnpm --dir apps/api exec vitest run test/utils/contentTiming.test.ts test/entry/contentEntry.test.ts test/handler/http/contentRevocation.test.ts` — 3 files / 25 tests passed.
- Web: `pnpm web -- test` with placeholder public localhost configuration — 257 files / 3165 tests passed; 1 file / 3 tests skipped. Existing happy-dom aborted-fetch teardown warnings were printed; command exit status was 0.
- API: `pnpm --dir apps/api exec tsc --project tsconfig.json --noEmit` — passed.
- Web: `pnpm web -- typecheck` with the same placeholder public localhost configuration — passed; localhost site-config warnings are expected for this fixture.
- Targeted API/Web ESLint on the touched source/tests/components — no errors; API's existing ignore configuration excludes its test files and reports three ignored-file warnings.
- `node --check apps/web/tests/fixtures/article-loading/audio-layout-browser-harness.mjs` — passed.
- `pnpm exec openspec validate --all --strict` — 161 items passed, 0 failed.
- `git diff --check` — passed.

The first full API/typecheck attempt lacked this fresh worktree's generated Prisma clients. Generating the D1/PG/log clients using local schema-only configs resolved setup; no DB connection/migration or tracked output was introduced. Fixture-only setup corrections supplied missing i18n and utility CSS; playback assertions await the real pause/storage event, sticky assertions use the responsive offset, and reload assertions start at the top to avoid browser scroll restoration affecting the geometry measurement. None required player behavior changes.

## Review

An independent Codex reviewer inspected the complete production diff, tests, fixture and OpenSpec against Bugs, Security and Compliance, including existing processor insertion, sticky styles and access/timing paths. Result: no Important findings and no actionable Nit. The reviewer did not rerun tests; running evidence is recorded above. Human acceptance and this final evidence file were completed after that initial implementation review.

## Human hands-on acceptance

The requester personally opened the prepared local browser fixture on November 20, 2026 and answered: “已实测，上述项目正常”. The question explicitly covered Enhance player/body stability, Draw highlight, image preview, 0:45 playback/seek and pause/reload/enhance/play resume. No additional adjustment was requested. This acceptance precedes opening the draft PR and satisfies DESIGN.md §10.2; it does not imply a native-client or production acceptance.

## Limits and follow-up

- No real iOS/Safari or native-client test was performed; native client code is unchanged. Chromium viewport coverage is not device coverage.
- The fixture does not exercise account synchronization, a full authenticated Nuxt app, production SQL/network, or previously identified contents/side-panel auto-opening shifts. Those are outside this bounded patch.
- Production RUM/70% LCP Good is not established by these local geometry tests. Compare the affected article cohort only after the normal production rollout and a sufficient observation window.
- Logs begin at JavaScript handler entry. `instance_id` is a module nonce, and `request_number` counts only observed metadata calls; neither is a provider-issued isolate lifecycle/cold-start marker. Compare entry/response summaries and native platform events by Ray ID to locate remaining gaps. Do not subtract timestamps across Worker clocks to claim queue/startup duration. Existing platform log retention/sampling still applies; no deployment or observability setting was changed here.
