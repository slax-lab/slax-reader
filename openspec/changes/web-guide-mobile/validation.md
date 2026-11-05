# Validation

Date: 2026-11-04. Branch: `fix/web-guide-mobile`, based on `origin/dev` at `fe0bc43c`.

## Automated checks

- `pnpm install --frozen-lockfile --filter @apps/slax-reader-dweb... --filter slax-reader`: passed; no lockfile or manifest changes.
- `pnpm web -- setup`: passed. Fresh worktree startup initially attempted transforms before generated Nuxt tsconfigs existed. Running setup and restarting development resolved this without source changes.
- `pnpm --filter @apps/slax-reader-dweb exec eslint app/pages/guide.vue`: passed.
- `pnpm --filter @apps/slax-reader-dweb lint`: failed with 96 errors and 437 warnings in unchanged files; this page has no reported findings. Unrelated lint fixes are outside this change.
- `pnpm web -- typecheck`: passed.
- `pnpm web -- test`: final run passed, 228 test files passed, one skipped; 2607 tests passed and three skipped. The first run had one suite fail to transform because of a missing generated tsconfig; after setup completed, the full suite passed. The suite also emitted existing API-fixture/network diagnostics without causing the final run to fail.
- `pnpm exec openspec validate --all --strict`: passed, 104 items, zero failed.
- `git diff --check`: passed.
- `pnpm web -- build`: passed. Existing Nuxt module/configuration and Rollup annotation warnings were emitted; the Cloudflare build completed successfully.

Checks and preview used process-local placeholder values documented in `docs/web/development.md` (local origins, test cookie name, placeholder OAuth client), without reading or copying secret environment files. The API is not configured in this worktree; Nuxt uses the public binding template.

## Running-environment verification

Started the actual application with `pnpm web -- dev --port 3107 --host 127.0.0.1`, then drove the rendered `/guide` using Python Playwright and installed Google Chrome in headless mode.

- Passed 72 combinations: Chinese/English × signed-out/signed-in footer × 320/375/390/768/769/1440px × light/dark/e-ink.
- At phone widths, asserted vertical card order without overlap, welcome text fitting its container, all card and image bounds within the viewport, loaded images with preserved aspect ratios, and footer buttons within the available width with at least 44px height. Scrolled to the footer to verify reachability.
- At 769px and 1440px, asserted horizontal card placement. Removing only the newly added responsive CSS block from the live stylesheet produced identical welcome/card/footer rectangles at both desktop widths. This is a CSS baseline comparison, not a second deployed application.
- The 390px baseline welcome region measured 358px wide with 565px scroll width; after the change it measured 358px for both, demonstrating the text overflow correction.
- Inspected full-page Chinese 320px light and 390px dark captures and English 390px light captures. Tutorial artwork retains its fixed approved colors in every theme.
- Signed-in footer coverage uses a synthetic, local cookie and in-memory user-store fixture after anonymous startup. Authentication handlers and destinations remain unchanged in the source diff. This proves footer presentation, not successful authentication.
- Evidence and the temporary checking script are outside Git: `/tmp/slax-guide-evidence/` (screenshots and `matrix.json`), `/tmp/slax-guide-matrix.py`, and `/tmp/slax-guide-*.log`. Nuxt's development-only floating toolbar was hidden for matrix screenshots; production markup and styles were used unchanged.

## Gaps and human acceptance

- Real Google OAuth, token refresh, authenticated API integration, and bookmark/reader/highlight/comment/Extension bridge smoke flows were not exercised: this worktree has no API or real OAuth configuration, and the diff only changes guide styles.
- Physical iOS/Android browser safe-area behavior was not exercised; safe-area CSS was inspected and browser viewport tests used zero simulated insets.
- Human hands-on acceptance: the requesting owner viewed the implemented local `/guide` preview and accepted it on 2026-11-04 ("看过了，效果可以，帮我提交并创建 PR 吧"). No further UI adjustments were requested. This acceptance preceded PR creation.

## Local review

Change identified as `web-guide-mobile`. Reviewed the page diff against the proposal, design, tasks, and `web-guide-layout` delta.

- Bugs: no Important findings; phone overrides are scoped to this page and breakpoint, and desktop geometry was checked.
- Security: no Important findings; no executable handlers, requests, dependencies, or external data boundaries changed.
- Compliance: implementation matches the approved layout scope. Full-site lint remains an explicitly recorded gap. Human hands-on acceptance is recorded above.

Web-only layout changes do not require a package-version increment under `docs/release/VERSIONING.md`. After accepting the UI, the owner explicitly requested an additional Mobile build-only increment: `1.0.28 (800)` to `1.0.28 (801)`, with previous source build 800. This does not claim build 800 was published. Mobile metadata regeneration and validation are recorded below; no signing or upload is performed locally.

## Mobile build-only follow-up

- `SLAX_MOBILE_NO_LOCAL_CONFIG=1 EXPO_NO_DOTENV=1 CI=1 pnpm mobile -- prebuild`: passed, reused the existing native projects. The unrelated generated Podfile Firebase-configuration change was restored; retained native diffs contain only versions generated from the manifest.
- Checked authoritative `readBuildVersion()` output and all seven generated Android/iOS main/share/runtime version locations: build 801, previous build 800, marketing version unchanged at 1.0.28.
- `pnpm mobile -- bundle` with local configuration disabled: passed, exported Android and iOS JavaScript bundles.
- `pnpm mobile -- check`: the initial run failed Kotlin host tests because `kotlinc` was absent from PATH. An existing compiler at `/tmp/mobile-polish-kotlin/kotlinc/bin` was found using repository development evidence. The full rerun with that directory prepended passed: architecture/assets/fixture/RSS checks, TypeScript, and 1272 tests passed, zero failed, three skipped (browser bridge parity, PDF WebView worker/ranges, and rotated PDF mark interoperability, which require optional browser test configuration).
- No secret environment files or service configuration were read or copied. No signed native build, device installation, upload, or store processing was performed; only metadata changes are claimed.

Final pre-push review covered the additional manifest/native/release-documentation diffs and the UI acceptance record. Bugs/Security/Compliance: no Important findings. Expo-generated diffs were inspected and contain only the requested version increments; no behavior or service configuration changes are included. Full-site Web lint remains the recorded pre-existing gap. All task checkboxes now reflect verified work.
