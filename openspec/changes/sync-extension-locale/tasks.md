# Tasks

## 1. Verify the port baseline

- [ ] 1.1 After proposal approval, fetch current `origin/dev` and inspect legacy PR #1615, reconciling the isolated branch and recording verified source and target SHAs in the PR.
- [ ] 1.2 Prepare dependencies without loading secret files, then run existing focused Web user-store and Extension session tests to establish and record the v2 baseline.

## 2. Port shared types and Extension synchronization

- [ ] 2.1 Add the frontend locale message/snapshot export and adapt response typing to v2 ownership; verify frontend package typechecks and account API envelope regression tests.
- [ ] 2.2 Port locale normalization, translation runtime, client subscription, and relay; verify dictionary placeholders, fallbacks, origin/frame rejection, initialization races, generation changes, and disposal tests.
- [ ] 2.3 Port background locale API/service, session-expiry safeguards, and alarm recovery; verify cache identity, logout/account switch, same-account rotation, stale 401, timeout, coalescing, and alarm lifecycle tests.
- [ ] 2.4 Integrate background events, content-script initialization, menu updates, and request locale headers; verify lifecycle, open-entrypoint, menu, event-identity, and existing offscreen regressions.

## 3. Port Web save and display consistency

- [ ] 3.1 Port locale request adapters, task coordination, and invalidation notification; verify real `code` envelopes, ordered saves, stale reads, token rotation, display convergence, and bounded refresh regressions.
- [ ] 3.2 Integrate the user store, actual Pinia fallback, and layout token refresh; verify current versus stale 401 handling and that offline profiles cannot overwrite confirmed language.
- [ ] 3.3 Update the settings selector and opt-in reselect behavior while preserving v2 presentation; verify opening settings does not save, rapid selection converges, and local display retry works.

## 4. Make Extension UI translations reactive

- [ ] 4.1 Port derived text for collection, summaries, side panel, menus, subscription, sharing, and selection/comment UI; verify translated labels update without clearing draft, focus, selection, or progress.
- [ ] 4.2 Port structured chat operation status and required dictionary entries; verify search/visit completion and failure retain their subjects and generated content remains unchanged.

## 5. Validate and deliver

- [ ] 5.1 Adapt the locale browser test fixture and package script to v2, using explicit non-secret configuration; verify the fixture builds and runs from the task worktree.
- [ ] 5.2 Run affected Web tests, the Extension test suite, shared package and application typechecks, lint on changed source, and Chrome/Firefox builds; record exact results and any independently confirmed baseline failures.
- [ ] 5.3 Run real Chrome locale integration checks for opposite browser/account languages, active drafts/operations, session changes, worker restart, and recovery; record timings and any unverified acceptance scenarios explicitly.
- [ ] 5.4 Run `openspec validate --all --strict`, `git diff --check`, and the Bugs, Security, and Compliance passes from `REVIEW.md`; resolve all Important findings and record `sync-extension-locale` as the matching change.
- [ ] 5.5 Commit, push `feat/sync-extension-locale`, and create a PR targeting `dev` with `OpenSpec: sync-extension-locale`, legacy provenance, and v2 verification results; verify and attach the created PR URL.
