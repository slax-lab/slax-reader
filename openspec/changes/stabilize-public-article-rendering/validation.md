# Validation

## Scope and environment

Implemented on November 13, 2026 in `fix/stabilize-public-article-rendering`, based on `origin/dev` at `293847be`, in a fresh managed worktree. The owner approved the revised four-item proposal in conversation. This is local implementation evidence, not a deployment or a 70% field-success claim. No production setting or stored snapshot was changed.

Node 24.15.0 and pnpm 11.25.0 were used. Web prepare/build used the development profile with the documented localhost placeholders, no API integration configuration. API generation used the public example configuration and dummy local database URLs; generation did not access a database. Generated tracked outputs remained unchanged.

## Automated verification

Commands ran from the repository root. Web commands below use the non-secret placeholder environment documented in `docs/web/development.md`.

| Command | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | Passed; no dependency/lockfile change |
| `pnpm web -- setup` | Passed |
| `pnpm web -- test --maxWorkers=4` | Final CI-review-fix run:241 files passed,1 skipped;2913 tests passed,3 skipped;exit0 |
| `pnpm api -- test --maxWorkers=4 --reporter=dot` | Final run:251 files passed,17 skipped;3980 tests passed,146 skipped;exit0 |
| `pnpm web -- typecheck` | Passed |
| `pnpm api -- typecheck` | Passed, including after the review fix |
| `pnpm api -- lint` | Final run passed;0 errors,343 warnings |
| `pnpm api -- gen:all` | Passed using `SLAX_API_CONFIG=deploy/cloudflare/api.toml.example` and fixture database URLs; no tracked generation drift |
| `pnpm web -- build` | Passed, including the final source after the review fix |
| `node --check apps/web/tests/fixtures/article-loading/hydration-browser-harness.mjs` | Passed after pinning the replay baseline |
| `pnpm exec openspec validate --all --strict` |143 items passed,0 failed |
| `git diff --check` | Passed |

The full Web suite prints a Happy DOM `AbortError` during teardown despite its zero exit code and passing test totals. It was not suppressed or misrepresented as a product-browser error. Tests requiring external/integration environments retain their reported skips. Web configuration emits the expected missing Turnstile/localhost development warnings.

Observed failing regressions before their fixes:

- Actual `BookmarkArticle` SSR-to-hydration test replaced the original text node despite identical content. The guarded local directive passes body presence, text/image identity, changed/empty initial HTML, fresh CSR, refresh/clear, keyed remount content and unrelated-update mark/handler retention.
- An ordinary/RSS R2 hit did not populate the edge cache. Both modes now preserve bytes and reuse the exact signed key without another R2 read.
- Valid exact-cover1500x600 metadata was absent from saved HTML. Capture now retains the pair through actual image rewriting and article construction; invalid/missing pairs, authored partial/full dimensions and unrelated images remain unchanged. Node uses a real `node:crypto` MD5 boundary mock because Workers' MD5 Web Crypto extension is unavailable in Node.
- Metadata timing contained only the orchestrator total; the new fixed stages are emitted without changing serialized metadata. Existing denied/privacy/owner/PDF tests pass.
- Warm HTML timing ended before a simulated30ms cached-body read and omitted backend/substep timing. It now distinguishes5ms match,20ms validation and30ms body, with55ms total in that controlled test. Production headers remain absent and credential/revision/TTL behavior passes its existing regressions.

## Running workerd verification

`apps/api/test/handler/http/imageProxy.runtime.test.ts` runs the production handler and real MD5/SHA helpers in local workerd, with a disposable native R2 binding and native Cache API. Both ordinary and RSS signed requests return the same bytes on first R2 hit, cached read and second handler invocation. The R2 getter is called once total; the second invocation uses the edge entry. MIME and public cache policy are retained. This verifies streamed cloning/cache population without inventing a Content-Length requirement.

## Built SSR and native browser evidence

The built server `useCommentPanel-*.mjs` contains the local directive's `getSSRProps` and a body render that merges directive props and emits `innerHTML`. The complete body is therefore preserved by compiler-ssr, not merely vnode-mode `renderToString`. The rejected one-line object-binding candidate was never implemented.

Run `node apps/web/tests/fixtures/article-loading/hydration-browser-harness.mjs` and open `http://127.0.0.1:4321/`. This fixture compiles the actual changed body element and directive from source for SSR and client rendering, restores payload HTML with the existing plugin, and uses the real MarkRenderer, ImageProcessor, ImagePreview, PodcastProcessor and custom podcast player. It is a bounded mechanism/interaction fixture, not a full authenticated Nuxt application.

Native Chrome observations:

- Complete SSR body, zero initial body assignments, original text/image nodes retained, no Vue hydration warnings. The compiled-binding control from pinned commit `293847be14ea7c30f31713a275726e705b66bf9d` performs one assignment and replaces both nodes.
- Actual marks are drawn, respond to clicks, survive an unrelated prop update, clear and redraw. The image handler and podcast player survive that update too.
- The real image preview component opens and dismisses through its existing background handler; the screen-lock callback returns to false. Fixture CSS is not a full product visual-parity claim.
- Known-duration audio starts with `preload=none` and zero media requests. A paragraph intent before metadata starts at45s in one gesture, overriding the saved30s position. Play/pause works; pausing around45s saves the position; refresh restores45s before media loading and play resumes there. This is existing localStorage-based resume, not authenticated server persistence.
- Native speed changes to1.25x; forward/back move approximately45.21→60.21→45.21 seconds while retaining paused state. At an observed390x844 viewport, Enter on the paragraph starts45s, pause works, and marks clear/redraw without body writes. A desktop fixture was also exercised.
- Temporary viewport override was reset and all agent-owned browser tabs closed. The local fixture server is available for review; no external account was modified.

### Three frozen production bodies

The three public SSR response snapshots captured earlier on November 13 were replayed locally. A new direct API probe returned403; no bypass was attempted. Public body snapshots and browser artifacts remain in ignored local evidence rather than being committed. The optional fixture argument accepts a directory containing `podcast.json`, `mole.json`, and `wechat.json`, each with a string `body`, then exposes `?sample=<name>&mode=current|baseline`.

| Canary | Replayed body bytes | Five baseline hydrations | Five current hydrations | Retained nodes |
| --- | ---: | --- | --- | --- |
| Podcast `ea02a6ad-22e9-49ec-bd63-1fb22bf98f75` |440911 |1 body write each |0 writes each |Text;no body images |
| Mole `a3b123af-27fc-4d12-b329-d8c4fd26b3f6` |26932 |1 body write each |0 writes each |Text and images |
| WeChat `acfbadd5-a6d2-4ccf-8266-7c4c76e030c5` |6858 |1 body write each |0 writes each |Text and image |

The15 interleaved pairs used an observed1502x702 desktop viewport, default CPU and unthrottled network. They establish the repeated-write mechanism, not controlled end-to-end LCP improvement. The serialization getter runs once; the large podcast body measured about0.7–0.8ms in these repeated runs. Timer resolution and concurrent verification processes make those values descriptive only; zero readings do not establish zero cost. Real-content replay does not claim successful localhost-Referer image delivery or podcast playback; those interactions used the separate real-component/local-media fixture.

## Review and resolution

A fresh read-only Claude Code reviewer requested and reported `claude-opus-5.5`. It received the runtime diff and relevant source/design/test context, with a fixed no-tools packet. It found no confirmed Important functional bug and identified diagnostic disclosure on failed metadata/cache validation. Codex promoted that concern into the fix pass: two tests first reproduced the fine-grained failed-response disclosure, then passed after stages were withheld until successful metadata resolution and denied validation stopped forwarding them. Final full suites passed after the fix.

The reviewer also questioned SSR compiler coverage, real-body serialization, remount assertions, native R2 cache behavior, image ratio CSS and resume coverage. These were checked through the built SSR output, three-body native replay, stronger unit assertions, real workerd test, existing compiled `max-width:100%;height:auto` reader rules, and native controls above. Metadata key order and existing sequential I/O remain intact. The reviewer did not receive the delta specs or later fixture additions; Codex completed the final Bugs/Security/Compliance pass over the complete diff and all three delta files. No Important finding remains unresolved for this local implementation.

The subsequent independent Codex architecture review and `claude-opus-5.5` edge-case review reported no Important findings and two Nits. Both are addressed: the replay control is pinned to the original base commit so fetching or merging `dev` cannot replace the old binding; failed metadata responses intentionally omit the former coarse `core_orchestrator` metric together with the granular metadata stages. Other outer request timings remain available outside production. This diagnostic-only change does not change the response status or access decision, and does not require a special runtime branch.

After these fixture/documentation-only follow-ups, a fresh fixture process on an ephemeral loopback port compiled the pinned baseline and current source, returned both complete SSR variants with HTTP200, and served the client bundle successfully. The syntax check, strict OpenSpec validation (143 passed) and whitespace check passed again. Runtime source was unchanged, so the earlier full-suite and browser evidence still applies. The final Bugs/Security/Compliance pass found no new Important issue; human acceptance remains pending under the explicit early-draft instruction below.

### PR #605 CI review follow-up

The first ready-for-review CI run passed Web/API validation and failed the review gate with two Important findings. The code finding was valid: the earlier negative timing test covered HTTP404 only, so it missed HTTP200 metadata whose role or revision rejected the cached page. The helper published backend stages before that decision. Forwarding now occurs only after both comparisons accept the cached page; the existing return decisions, access checks and fallback are unchanged.

Three utility regressions and five strengthened middleware cases first failed against the previous source, then all33 focused tests passed after the fix. A standalone local HTTP exercise ran the actual h3 middleware with a loopback metadata server: accepted metadata served the cached body with backend timing; changed body, visibility or role metadata and HTTP404 served the fresh fallback with only frontend timings; the production-profile accepted response omitted diagnostic headers. Both HTTP servers were closed after the exercise. This is a running middleware check, not authenticated product acceptance.

The archive-order Nit is answered in `proposal.md`: classify outstanding tasks and archive `optimize-public-article-lcp` first, then archive this change; do not archive their shared capabilities in parallel. The image-cache Nit does not require a code change: native workerd already verifies that streamed R2 responses populate the Cache API without an invented Content-Length requirement, and the new branch uses the existing origin branch's `waitUntil(cache.put(...))` policy. Adding a silent rejection handler would hide cache-write failures, while changing error policy in both branches is outside this fix.

After this fix, the complete Web suite passed241 files/2913 tests (1 file/3 tests skipped), with the same recorded Happy DOM teardown AbortError and exit0. Web typecheck passed with the documented non-secret localhost configuration. Strict OpenSpec validation passed143 items and `git diff --check` passed. API runtime code is unchanged by this follow-up; the existing API evidence and green API CI remain applicable. The local Bugs/Security/Compliance pass found the diagnostic code issue fixed, no new access/data/contract change, and the human-acceptance item below still open.

The remaining Important finding requests current-branch human hands-on acceptance. No acceptance is inferred from creating the draft or marking it ready for review, and no test result is substituted for it. The owner has been asked for the actual environment and highlight/image/podcast results. This record remains pending that response.

## Explicit remaining verification and release boundaries

- Full authenticated Nuxt integration, creating/saving/deleting highlights and comments against a development account, and account-switch/back-forward flows were not exercised: this fresh worktree has no configured local API/account. Renderer/handler preservation is covered; server persistence is not claimed.
- Physical iPhone Safari and Android Chrome Web playback were not exercised. This is a Web-browser regression gap: the changed Vue hydration code runs in browsers. No native iOS/Android application or Mobile package code is changed or requires a native rebuild. Chrome mobile viewport is not a physical-browser substitute.
- The final controlled1.6Mbps/750Kbps/150ms/CPU4x end-to-end LCP/TTFB gate was not run against a fully configured candidate; these fixture timings do not satisfy it. Production first-byte attribution needs requests in the authorized test environment; this implementation changes timing visibility, not queries or placement.
- Existing Mole storage was not modified. New capture dimensions do not repair its old body. Field CLS1.798 remains unattributed; the prior image-only CLS0.09 reproduction is not an explanation of all field shifts. A legacy repair still needs its bounded revision-aware preview if required after remeasurement.
- No deployment, production configuration flip or seven-day field outcome was performed. Podcast and Mole each still require the existing70% raw/matched-mix outcome contract after build/cache convergence and sufficient counts.
- Human hands-on acceptance for this branch has not been recorded. The prior PR's acceptance does not substitute. DESIGN.md section10.2 ordinarily requires it before opening a UI-visible behavior PR. After the gap was disclosed, the owner explicitly requested an early draft PR on November 13, 2026; that instruction authorized opening the draft for review and did not constitute acceptance. PR #605 was created as a draft and is now marked ready for review in GitHub; its review gate correctly still requests the missing acceptance record. Its readiness state has not been changed as part of this CI fix.
- Version assessment: Web/API only. No CLI/Extension/Mobile logic, public API contract, dependency or package output changed. `docs/release/VERSIONING.md` excludes Web/API from package-version increments; no version decision is required here.
