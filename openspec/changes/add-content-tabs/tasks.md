# Tasks

## 1. Review and Runtime Preparation

- [x] 1.1 Record proposal review and permission to start applying the real-component demo; verify the conversation confirms the existing-style, worktree-only scope.
- [ ] 1.2 Prepare dependencies and documented Web/native fixture development commands inside the isolated worktree without reading or copying secret files; verify both original application surfaces run and record any runtime blocker.

## 2. Shared Interaction Policy

- [x] 2.1 Add the bounded feed-candidate policy in an existing package consumed by both clients; verify existing test tooling covers positive path/query cases, false positives, invalid schemes, and preserving the original query.

## 3. Real Web Add Surface

- [x] 3.1 Extend the existing add modal with capability-gated tabs, session drafts, localized inline hints, and active-mode actions; verify `AddUrlTopModal.spec.ts` covers the four gate combinations, explicit switching, dismissal, and no network requests during detection.
- [ ] 3.2 Wire existing RSS add entry points to Feed in the unified modal while retaining the existing subscription service and separate edit dialog; verify integration tests preserve URL local-first/fork behavior, subscription errors, and single-PDF upload behavior.
- [ ] 3.3 Show the actual changed Web route in the running application at desktop, 768px, and 320px in light/dark/e-ink and Chinese/English; verify tab keyboard access, focus restoration, error/busy states, and no overflow, and attach demo evidence without committing screenshots.

## 4. Real Mobile Add Surface

- [x] 4.1 Compose the real Library acquisition flow within the existing centered compact dialog using the current native controls, typography, colors, and spacing; verify mounted-host tests cover mode entry, gate changes, clipboard prefill, and unchanged title editing.
- [x] 4.2 Reuse RSS submission and PDF lifecycle handling while keeping drafts outside the active panel; verify existing PDF import and RSS suites cover picker cancellation, tab switching, cleanup on close, upload failure, account replacement, and duplicate-submit prevention.
- [ ] 4.3 Run the actual changed React Native application on an available native target and demonstrate URL, RSS hint, Feed, File, gate-off, error/busy, and keyboard-visible states; record the target and attach captures, without substituting a browser mock for native evidence.

## 5. Demo Feedback and Completion

- [x] 5.1 Present the real Web and App demos to the change requester, update requirements from feedback, and record only the actual demo approval and covered states in `proposal.md`; verify no unreviewed layout redesign is treated as approved.
- [x] 5.2 Run the existing affected shared/Web suites, Web typecheck/build, `pnpm mobile -- check`, and `pnpm mobile -- bundle`; verify successful outputs or explicitly record unrelated failures without claiming completion.
- [ ] 5.3 Exercise the original URL-save, RSS-add, and PDF-upload scenarios through real application calls in an authorized test environment, and record results in `validation.md`; verify both native platforms before claiming full native acceptance and state any remaining platform gap.
- [x] 5.4 Before implementation handoff or any future PR, obtain the Mobile version decision and required human hands-on acceptance, run the prescribed review and `openspec validate --all --strict`, and inspect `git status` for task-created artifacts; verify no commit, push, release, or unrelated cleanup occurred without authorization.
