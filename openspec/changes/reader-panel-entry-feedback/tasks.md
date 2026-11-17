# Tasks

## 1. Early activation feedback and handoff

- [x] 1.1 After proposal review, prepare the task branch `fix/reader-panel-entry-feedback` from current `origin/dev`, preserving unrelated local changes; verify branch/base and inspect any newly merged panel-placeholder work before editing product files.
- [x] 1.2 Extend `apps/web/tests/unit/utils/readerStartup.spec.ts` with initially failing cases for a click before page readiness, repeated clicks, last-choice replacement, one-time consumption, and discarding intent on article navigation; verify the tests exercise the actual inline script.
- [x] 1.3 Extend `apps/web/app/utils/readerStartup.ts` with the bounded early panel-intent listener and document-root busy marker, then consume it in `apps/web/app/pages/b/[id].vue` through the existing panel handler after mounted reset; verify the new startup cases pass and the existing reader navigation tests retain their behavior.

## 2. Consistent visible icon loading

- [x] 2.1 Add `apps/web/app/components/Snapshot/SnapshotPanelIcon.vue` and stable entry markers to `SnapshotRightEdgeToolbar.vue`, `SnapshotSidePanel.vue`, and `SnapshotBottomToolbar.vue`; verify same-size ordinary/loading icons, translated control/loading names, retained keyboard focus, and reactive pending state in the existing Snapshot toolbar/side-panel unit suites.
- [x] 2.2 Track pending AI and Chat component code in the existing async declarations in `/b/[id].vue` without altering their content loading component or access gates; verify held resolve, rejection, existing 15-second timeout, switching, closing, and already-resolved imports through focused tests or the actual reader lab.
- [x] 2.3 Verify the new ring uses existing semantic colors, remains distinguishable without animation in reduced motion and e-ink, and retains the existing 18px/20px icon and 44px control geometry; run `pnpm icons:check` to confirm ordinary registry icons remain valid.

## 3. Running-environment evidence and delivery

- [x] 3.1 Extend the opt-in `apps/web/tests/fixtures/reader-startup` browser checks to hold the real client entry, activate an SSR-visible panel entry, assert immediate feedback before release, and verify exactly one normal activation after release with no hydration mismatch; capture the actual results in this change's `validation.md`.
- [x] 3.2 Independently hold AI/Chat component delivery and verify visible icon feedback plus the existing content placeholder, then completion, rejection, timeout, close, and switch outcomes; exercise active, inactive, pending, and failed subscription decisions, retaining the current reader-position regression checks and recording results.
- [x] 3.3 Exercise desktop 1280px, the 768px transition, and narrow mobile 375px in light, dark, and e-ink themes, plus reduced motion and keyboard activation; record any initially absent responsive control as inapplicable rather than introducing a new entry. Prepare a running environment for the requester to repeat the 3G interaction.
- [x] 3.4 Run focused Web unit tests, Web lint/typecheck, `git diff --check`, and `pnpm exec openspec validate --all --strict`; record real outcomes and any declared agent-verification gaps in `validation.md`, and resolve Important findings from REVIEW.md's Bugs, Security, and Compliance passes before pushing.
- [x] 3.5 Obtain and record human hands-on acceptance of the running implementation and any adjustments before opening a PR targeting `dev` with `OpenSpec: reader-panel-entry-feedback`; verify the PR evidence matches what was actually exercised. Keep archive work for a separate human-reviewed docs PR after merge.
