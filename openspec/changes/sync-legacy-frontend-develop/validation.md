# Validation log

## Baseline and setup

- 2026-10-09: user approved the proposal and implementation.
- GitHub branch API and `git fetch origin dev` confirmed the audited source and target SHAs remain current.
- Frozen frontend workspace installation completed with unchanged package versions and lockfile. The full workspace install encountered a policy-blocked `.env.sample` in an unrelated API dependency; the frontend-only install excludes that dependency.
- A fresh virtual dependency store resolved a stalled partial installation. Nuxt generation in the worktree then hit a directory-cleanup permission error. Runtime checks use a secret-free copy of the tracked task source under `/tmp/slax-frontend-sync-check` with its own installed frontend dependencies. The initial temporary copy's hook installation failed because it is not a Git repository; task-worktree hooks were installed normally, and frontend install/build steps completed. No production environment files are loaded.
- Baseline Web suite: **173 files passed, 1 skipped; 1859 tests passed, 1 skipped**. Baseline Extension suite: **5 files / 18 tests passed**.
- Imported tag tests run before implementation: **9 failed / 50 passed**, exposing missing variant markup, detail chips, action icons, and overflow behavior.

The temporary validation copy is refreshed from this worktree's tracked/untracked source inventory, explicitly excluding all environment filenames, dependencies, and generated outputs. Final source fidelity is checked before publication.

## Completed checks

Commands used the app manifests in the secret-free validation copy, with public localhost URLs and an OAuth placeholder. All commands below exited successfully:

| Check | Result |
| --- | --- |
| `pnpm --filter @apps/slax-reader-dweb typecheck` | Passed |
| `pnpm --filter @apps/slax-reader-dweb test` | 175 files passed, 1 skipped; 1887 tests passed, 1 skipped |
| `pnpm --filter @apps/slax-reader-dweb build` | Cloudflare Pages build passed, repeated after final CSS changes |
| `pnpm --filter @apps/slax-reader-extensions compile` | Passed |
| `pnpm --filter @apps/slax-reader-extensions test` | 5 files / 18 tests passed |
| `pnpm --filter @apps/slax-reader-extensions build` | Chrome MV3 build passed |
| `pnpm design:check` | 33 design reference files validated |
| `pnpm exec openspec validate --all --strict` | 22 items passed, 0 failed |
| `git diff --check` | Passed |

After final test-title/comment cleanup and reduced-motion CSS adjustments, the two affected Web test files were rerun: 61 tests passed. The full suite includes existing outline-anchor and article integration regressions. The skipped Web test was also skipped at baseline. Build warnings concern optional Turnstile configuration, localhost SEO URLs, and bundler annotations/chunk sizing; none failed a command.

## Browser checks

A temporary Vite fixture loaded the actual task-worktree tag components, table processor, article styles, theme tokens, and the application's UnoCSS configuration. Compact wrappers mirrored BookmarkCell's flex/overflow containment. API data was a local fixture. Browser viewports included 360px, 768px, and 1440px; the layout matrix exercised 360px, 768px, and 1280px component widths across light, dark, and e-ink.

- Final layout matrix: 45 checks passed, 0 failed. Short tables use native table layout and fill available width; wide content scrolls at narrow widths and returns to native layout on desktop. Saved table annotation elements retain their original hierarchy.
- Both compact tag variants retain their add/overflow controls inside the row. Long detail names truncate, read-only tags have no removal actions, and the narrow fixture has no page-level horizontal overflow.
- Reproduced the imported hover-border change and keyboard navigation into hidden measurement controls. After fixes, the card border remains unchanged and sequential Tab moves from visible tag actions to overflow and the next row, skipping measurement controls.
- Native Enter on the detail removal control increments removal without an extra selection event. Topic/detail/list behavior is additionally covered by component tests.
- E-ink computed transition durations are zero. Reduced-motion media rules were checked through CSS cascade review; operating-system reduced-motion preference emulation was not available in this browser interface.
- The exact Extension keydown handler was extracted into a real textarea fixture: Shift+Enter at the middle of `abcd` yields `ab\ncd`, caret 3, no send; Command+Enter in macOS mode and Control+Enter in non-macOS mode insert one newline at the caret; plain Enter sends; the composition guard prevents sending.
- A host-style fixture using the Extension's fixed/visible/high-z-index settings remained above a lower-stacking banner in browser hit testing.

This is component and native-input smoke coverage, not a signed-in application or installed-extension end-to-end run. Live annotation rehydration, backend tag persistence, real IME events, and the complete extension injection lifecycle were not exercised. Existing unit/integration coverage and compilation/build checks complement these limits.

## Regression evidence and pre-push review

The imported tag tests first failed (9 failed, 50 passed) before application code was ported. Extra regressions exposed keyboard bubbling and stale detail interactivity (3 failed, 67 passed), then passed after fixes. Measurement accessibility assertions failed in both list variants before `inert` was added (2 failed, 42 passed), then passed in the complete suite.

A separate reviewer read `REVIEW.md` and completed Bugs, Security, and Compliance passes against `sync-legacy-frontend-develop`. Three Important findings were resolved: hover-border specificity, focusable hidden measurement controls, and reduced-motion override specificity. Final review: **No Important findings**. No actionable Security finding was identified.

The application path inventory equals the original 23 audited paths, and all 23 files match the independently installed validation copy byte-for-byte. No source checkout files, production configuration, shared contracts, dependencies, or lockfile content were changed.
