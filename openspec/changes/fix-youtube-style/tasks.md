# Tasks

## 1. Regression evidence

- [x] 1.1 Add focused processor regressions before implementation; observe failures for absent chapter controls, duplicate-processing expectations, and paragraph playback indicators, then verify the corrected processor tests pass.
- [x] 1.2 Add `apps/web/tests/fixtures/media-recovery/20261029-youtube-style-check.mjs` using installed Sass, UnoCSS, Vue, and Playwright tooling; observe computed 28px line height, 24px paragraph top margin, and 16px justified contents before the CSS fix, then verify the full compiled-reader cascade passes.
- [x] 1.3 Capture the reported bookmark's current saved-body rendering and text/anchor identity using read-only access; label environment, viewport, theme, and article version without storing private metadata or screenshots in Git. See `validation.md` for the real 17-section/85-paragraph source and anonymous replay boundary.

## 2. Scoped correction

- [x] 2.1 Correct descendant inheritance and important spacing inside the dedicated mixin; verify both body paths at 375, 768, 769, and 1200px in light/dark/e-ink with computed 18px/33.3px paragraphs, 0/20px paragraph margins, 26px/1.4 headings with 44/20px margins, and 14px start-aligned contents.
- [x] 2.2 Append native chapter controls using existing heading start times and the YouTube seek bridge; hide paragraph timestamps without removing nodes, disable edited-body paragraph following, and remove playback decoration. Verify node/anchor stability, cleanup, idempotence, zero-time handling, and retained paragraph selection timing in focused processor tests.
- [x] 2.3 Keep the expanded component's existing chapter controls working through shared body styling; verify both paths' 12px accent controls and visible focus in the compiled cascade. Verify ordinary article, raw-caption, and podcast computed negative controls remain unchanged.
- [x] 2.4 Run focused processor/component/podcast tests and applicable lint; inspect the diff for unchanged player/sidebar/raw/podcast code and absence of global reset, API, dependency, or packaged-app changes. All 41 focused tests and scoped ESLint pass.

## 3. Running verification and screenshots

- [x] 3.1 Run `pnpm web -- typecheck`, `pnpm web -- test`, `pnpm web -- build`, `pnpm exec openspec validate --all --strict`, and `git diff --check`; all passed. Full suite: 224 files/2,559 tests passed, 1 file/3 tests skipped. Evidence and configuration boundaries are in `validation.md`.
- [x] 3.2 Exercise the actual reported article in the complete running app: saved path passed 15 theme/width combinations and expanded path passed 12. Verify exact 85-paragraph text, 17 chapter controls, layout, focus exclusion, contents navigation, Enter/Space events, and processor-level annotation node identity; documented authenticated annotation-persistence gap remains.
- [x] 3.3 Capture and present matched before/after Chrome screenshots for the contents, chapter controls, paragraphs, introduction, and method notes, with desktop/mobile coverage. Key PR groups are desktop reading, desktop contents, and mobile reading; introduction/method comparisons were also shown in the conversation. All images stay outside Git and distinguish live baseline from local implementation.
- [x] 3.4 The requesting user inspected the final-source local Chrome preview on 2026-10-29 and accepted the YouTube body appearance. They separately reported sidebar push behavior and requested a smaller YouTube-only diff; this does not accept or authorize sidebar changes. See the dated follow-up in `validation.md`.
- [x] 3.5 Remove the processor-wide WeakSet/context cleanup wrapper and timestamp attribute mutations; retain only a heading-local duplicate-button guard. Verify unchanged paragraph DOM/attributes in unit tests, CSS-hidden stamps cannot receive focus in Chrome, both real-content paths pass 12 theme/width combinations each, and the full typecheck/test/build chain passes.

## 4. PR handoff and cleanup

- [x] 4.1 Run Bugs, Security, and Compliance local pre-push review passes from `REVIEW.md`; independent review found no Important source issues. Re-review the minimization: original lifecycle and contents code are untouched, generated chapter controls clean up locally, and no sidebar/player/API files change.
- [x] 4.2 Commit/push `feat/fix-youtube-style` and open PR #441 targeting `dev` with `OpenSpec: fix-youtube-style`, validation evidence, and six uploaded screenshots. Initial handoff was draft before acceptance; body acceptance is now recorded. No merge or deployment occurred.
- [x] 4.3 Initial task cleanup completed after PR handoff and was recorded in PR #441. The user subsequently requested reopening the local browser, so the worktree and preview were deliberately restored; retain that requested preview during the current review rather than silently deleting it again.
- [ ] 4.4 Deferred until a later merge: classify every unchecked task and archive through a separate documentation PR, sequencing after the `restore-media-article-recovery` capability delta; preserve both requirement sets and pass strict OpenSpec validation. This final archive item stays unchecked in the current PR-only task.
