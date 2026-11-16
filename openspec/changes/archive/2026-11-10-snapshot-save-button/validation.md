# Validation

## Scope and environment

- Date: 2026-10-27 (Asia/Shanghai). Implementer/reviewer: Codex.
- Primary checkout: `feat/snapshot-save-button`, based on `origin/dev` at `0ba059f55777a0c40f7d998554b9edbbe58da9fa`.
- The owner approved the proposal and implementation on this branch, then accepted the result after local hands-on testing on 2026-10-27 before PR creation.
- Web presentation and documentation only. No CLI, Extension, Mobile, shared runtime, dependency, or package-output change affecting those applications; their version-decision requirement does not apply.
- Root Web command wrappers try to load protected local environment files. These files were not read or copied. Nuxt checks instead used a temporary copy of current tracked Web/shared/tooling sources, excluding all secret files, with existing installed dependencies and isolated generated/cache directories. Configuration values were disposable localhost placeholders. Temporary fixtures and build outputs are outside the repository.

## Automated checks

| Check | Result |
| --- | --- |
| `pnpm icons:write` | Generated the registry from the curated source entries; no manual generated-file edits. |
| `pnpm icons:check` | Passed: 56 registry entries. |
| `pnpm icons:test` | Passed: 17 tests. |
| `pnpm design:check` | Passed: 33 reference files; frozen reference unchanged. |
| Web `node_modules/.bin/eslint . -f json` | Failed: 99 errors and 436 warnings. All error-bearing files are outside the diff. Both changed Vue files have zero errors and warnings. No unrelated mass fixes were applied. |
| `node_modules/.bin/nuxt prepare --dotenv /dev/null` | Passed in the temporary source copy. |
| `node_modules/.bin/vue-tsc --noEmit -p .nuxt/tsconfig.app.json` | Passed after the final responsive adjustment. |
| `node_modules/.bin/nuxt build --dotenv /dev/null` | Passed after the final responsive adjustment; Cloudflare output generated. Existing configuration/module warnings remain. |
| `node_modules/.bin/vitest run tests/unit/composables/bookmark/useBookmarkFork.spec.ts tests/unit/components/AppIcon.spec.ts` | Blocked before test execution: Nuxt test initialization could not resolve `/@fs/.../@nuxt/test-utils/dist/runtime/entry.mjs`. Both suites reported zero executed tests. This is not a passing regression-test result. |
| `node_modules/.bin/openspec validate --all --strict` | Passed: 77 items, zero failures. |
| `git diff --check` | Passed. |

Local diagnostic logs are `/tmp/snapshot-save-{lint.json,typecheck.log,build.log,tests.log,openspec.log}`. They are ephemeral aids; this record contains the authoritative result summary.

The temporary dependency layout first caused package-manager state/cache errors. Isolating cache directories and invoking the existing binaries directly allowed typecheck and build to complete. The remaining test-runtime resolution problem is recorded as an agent-verification gap; application dependencies and test configuration were not changed to hide it.

## Running presentation verification

A local Vite fixture at `http://127.0.0.1:3197/` rendered the actual `SnapshotForkButton`, `AppIcon`, `SnapshotTopBar`, theme switcher, share, and More components. Its header markup and scoped styles were extracted from the current `/b/[id]` page, including the non-owner save-header class; it used the actual theme tokens, global styles, UnoCSS configuration, and locale files. Only Nuxt integration and the save composable were replaced with deterministic fixture state. Therefore this exercises real presentation and DOM behavior, not backend admission or authentication.

The matrix covered Chinese and English, light/dark/e-ink, and widths 320, 380, 381, 480, 481, 768, 769, and 1280px. Each combination included unsaved, in-flight, saved, metadata-unready, and failed states: 240 rendered cases total.

- Initially, English unsaved at 320px placed the More control's right edge at 324.19px; at 381px it reached 418.66px. The page-scoped compact header adjustment resolved this. In all final 240 cases, visible header controls stayed within the viewport with no overlapping hit boxes, full localized save text, and a 44px save-button height. At 320px, the final More control ends at 308px.
- Unsaved: outline 14px SVG and `收藏本篇` / `Save for later`; enabled when ready.
- In-flight: outline SVG and `收藏中…` / `Saving…`; disabled, `aria-busy="true"`, 0.6 opacity.
- Saved: filled SVG and `已收藏` / `Saved`; disabled with opacity 1. Exactly one leading SVG and no trailing checkmark. Saved text/icon colors were `rgb(180, 88, 55)` in light, `rgb(212, 118, 79)` in dark, and black in e-ink, supplied by existing semantic tokens.
- Unready metadata: unsaved presentation, disabled with 0.6 opacity.
- Failed: unsaved presentation and enabled retry; the existing live region announced `收藏未成功，请重试。` in the controlled failure exercise.
- Keyboard: Enter activated the action and showed the busy state. A controlled failure restored retry; Tab/Shift+Tab returned focus with a 2px accent outline and 3px offset. Space retried successfully; controlled completion showed the filled star and disabled saved state.
- Accessibility: the localized button text provided the name, the 14px SVG had `aria-hidden="true"`, and the existing error live region remained present.
- Motion: the changed button has no animation or transition (`animation-name: none`, `transition-duration: 0s` observed). No new motion depends on the reduced-motion preference. An OS-level reduced-motion toggle was not exercised.
- The initial live fixture had no browser console errors. Screenshots were visually inspected for the actual header presentation.

Ephemeral evidence: `/tmp/snapshot-save-evidence/matrix.json` contains the final 240 measured cases; `/tmp/snapshot-save-evidence/saved.png` shows the saved-state component preview. Media is not committed.

## Declared gaps and human acceptance

- The complete authenticated `/b/[id]` route and live API were not exercised: protected local configuration was unavailable to the agent. The fixture does not verify real login, offline admission, persisted viewer status, owner visibility, or source/account isolation. Their implementation was left unchanged; the existing unit suites were attempted but blocked as described above.
- The matrix covers the theme switcher's resting state. Its expanded hover layout and unrelated article/share flows were not exhaustively exercised.
- Human acceptance: the requesting project owner confirmed on 2026-10-27 (Asia/Shanghai), in this task conversation, that local testing passed without issues and authorized PR creation with the supplied screenshots. No further adjustments were requested. The owner's screenshots show the real article route in the English/light desktop presentation: `Screenshot 2026-10-27 at 09.41.50.png` shows an outline star and `Save for later`; `Screenshot 2026-10-27 at 09.41.56.png` shows an accent-colored filled star and `Saved`, with no trailing checkmark. Both retain the neighboring share control. Attach both originals to the PR using `gh --attach`; do not commit image files. This human acceptance complements the agent's fixture matrix; it does not claim additional coverage for the unverified backend/account scenarios above.

## Local review

- **Bugs:** no Important findings in the final diff. State ownership, eligibility, duplicate prevention, event emission, and error flow remain intact. Narrow-header clipping found during runtime exercise was fixed and rechecked.
- **Security:** no Important findings. No new network request, dependency, external SVG injection, sensitive-file access, or persistence path. Icons use existing curated geometry through `AppIcon`.
- **Compliance:** matched to `snapshot-save-button`. Labels, star states, design tokens, SVG registration/documentation, saved-state behavior, and compact page-only layout match the approved scope. Generated icon output came from its generator. Agent verification gaps are explicit. The owner completed human hands-on acceptance before PR creation and authorized attaching both screenshots. The final pre-push review found no Important findings.

After the task PR merges, classify remaining unchecked tasks and archive through the separate documentation PR required by repository policy.
