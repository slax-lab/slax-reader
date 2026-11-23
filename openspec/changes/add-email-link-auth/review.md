# Implementation Review

Reviewed against `add-email-link-auth`, the applicable application rules, and the Bugs/Security/Compliance passes in `REVIEW.md` on 2026-11-18.

| Review | Finding | Resolution |
| --- | --- | --- |
| Codex | A signed-in refusal retained proof and revived it after sign-out | Clear the proof when showing the current-account notice. A session replacement cancels the old attempt; initial local readiness remains supported. Regression reproduced before the fix. |
| Codex | Rebuilding the controller after an origin change replayed the cold launch URL | The hook owns a launch-consumed marker across controller replacements; activation generations reject callbacks from disposed controllers. New warm links remain usable. Regression reproduced before the fix. |
| Codex / Claude Opus 5.5 | Restoring a logged-in session after the cold URL arrived hid the required notice | Initial loading-to-authenticated readiness now presents the current-account notice and discards the proof. Regression reproduced before the fix. |
| Claude Opus 5.5 | A same-account credential refresh dismissed the notice | Preserve the notice for the same authenticated user, without retaining the proof. Regression reproduced before the fix. |
| Claude Opus 5.5 | A link arriving during an existing email/Passkey session commit remained invisibly pending | Discard that link without interrupting the existing session commit. Mounted tests cover both existing login methods. |
| Claude Opus 5.5 / follow-up | A canceled link left its old agreement sheet open | Close only the email-link agreement when its attempt retires; mounted iOS and Android tests reproduce the stale sheet before the fix. |
| Codex | An unused copy of intent filters was passed to the Share plugin | Removed it; main-App intent filters remain under Expo's Android config. |
| Claude Opus 5.5 | Suggested placing cross-environment handling before the current-session check | Not adopted: the reviewed requirement explicitly prioritizes preserving an authenticated account and explaining sign-out/reopen. The reviewer withdrew the reorder after checking that requirement. The delta scenario now states that cross-environment browser continuation concerns an unauthenticated App. |
| Claude Opus 5.5 | Conditional concern that same-identity hydration would emit and discard pending links | Withdrawn after inspecting the actual session owner and running a new test with the real `SessionController`, `PreferenceStore`, and fixture storage. Agreement and an in-flight request both survive `restoreLocal()` followed by same-identity `restore()`. No production workaround was added. |

The final Codex recheck reported no remaining Important finding. Actual Claude Code runs requested `claude-opus-5.5`; returned `modelUsage` identifies that model. The final evidence follow-up reported no remaining Important or blocking finding. Review results do not replace native or real-mail acceptance.

Temporary review receipts and RED/GREEN logs are under `/tmp/slax-email-link-20261118/`. No credentials or media are committed. One initial tool-driven Claude attempt exhausted its turn limit; only the subsequently completed reviews and their follow-ups count as review evidence.

## Internal log follow-up

A fresh Codex subagent reviewed the prerequisite code-only merge and current link-log diff against Bugs/Security/Compliance and API layer rules. No Important finding was reported. Its single documentation Nit (the generic mail scenario needed to specify ordinary addresses) was fixed. Actual Worker smoke confirms internal log proofs work and are single-use; this is not native or live-email acceptance.

A fresh actual Claude Code review also completed with returned modelUsage `claude-opus-5.5` and no Important findings (`internal-link-opus.json`). Its two Nits were fixed: the HTTP log-match variable is now captured after polling rather than assigned through a closure, and duplicate blank lines were removed.

## Final local pre-push pass

The Bugs/Security/Compliance passes were rechecked against `origin/dev` at `c909a719` before submission. Existing route constants, domain orchestration, infra-only Redis access, account/session ownership and source-generated native configuration remain intact. No database, PowerSync, certificate trust, dependency or unrelated production refactor is included. No unresolved Important finding was identified. The explicit internal-domain log exception is the requester-approved scope; ordinary proofs and personal mailbox artifacts are excluded from committed/public evidence.

Web and the exercised signed iPhone flows have human acceptance. On 2026-11-18 the requester explicitly authorized the task-specific order of opening the Draft PR before complete Android acceptance in Play Beta. This is recorded as an exception for this task, not as a completed Android test or a repository-policy change. The remaining tasks and mail-client/routing boundaries are retained in `validation.md`.

## Android acceptance correction

The automated review of head `5c3a8f78` reported one Important Compliance finding because the evidence still described Android hands-on acceptance as absent. On 2026-11-18 the requester clarified that they had already tested Android local dev and explicitly requested updating the record. `proposal.md`, `tasks.md`, `validation.md` and the PR Test plan now distinguish that requester-reported local-dev acceptance from the remaining Play-signed automatic App Link verification. No per-scenario device results or signing evidence were invented, and no review policy or production code changed. The automated verdict must be reassessed against the updated record; the previous failed gate is not represented as passing.
