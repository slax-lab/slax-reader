# Validation and delivery

## Review outcome

Change: `koc-onboarding-continuity`. Branch: `fix/koc-onboarding-continuity`, in an isolated Codex worktree based on `origin/dev`. The original checkout and its unrelated work were preserved.

The plan review clarified verified identity, database ownership, storage-denied startup and the ordinary modal caller. The implementation review ran Bugs, Security and Compliance passes and found three Important issues: success disposal on navigation, an older check erasing a newer campaign, and collection readiness surviving an account switch. These were corrected and covered by regression tests. The reviewer reported no additional Security findings. The final author pass inspected the follow-up fixes and acceptance criteria.

## Automated evidence

- Web full suite: 189 files passed, 1 skipped; 1,994 tests passed, 1 skipped. Includes real Vue Router / KeepAlive KOC-to-onboarding journeys, successful acknowledgement, navigation away after success, delayed A-to-B invitation replacement, submission attribution, URL-only deferral/resume, the ordinary caller, shared onboarding flags and authentication return preservation.
- Installed PowerSync Vue query API: exercised with a controlled database adapter. First synchronization pending, successful empty/nonempty results, query errors, offline-after-verification and ownership mismatch are covered without replacing the query composable itself.
- API full suite: 158 files passed, 9 skipped; 1,884 tests passed, 46 skipped. New promotion contract tests verify receipt precedence, Apple exclusion, trial/credit descriptions, legacy compatibility and unchanged grant inputs. The reward-writing transaction was not changed.
- Web, API and shared-contract typechecks passed with explicit non-secret fixture configuration.
- Touched Web production files pass ESLint with zero errors; four pre-existing warnings remain in existing code.
- Static Web generation succeeds. Strict OpenSpec validation passes all 35 items. `git diff --check` passes.
- Regression red/green evidence includes delayed readiness, unvalidated persistence, session/profile isolation, storage-denied startup, success route departure, competing invitations and URL-only resume. The original production incident was traced from source; it was not replayed against a real user's account.

## Controlled browser evidence

The built Web application was served on `127.0.0.1:3107` with mock API responses and a disposable fake account. PowerSync storage failure was injected at startup, exercising the real REST fallback. No production promotion, Stripe credit or Apple subscription was consumed.

Verified in the Codex in-app browser:

1. `/daguang-reader` reaches the root URL and displays the 60-day offer before onboarding.
2. Later enters onboarding; a full document reload restores the deferred KOC entry without reopening the offer.
3. Skipping onboarding returns to `/`; the KOC entry is still available and the cached page does not loop back.
4. Resuming and claiming shows success without a forced reload; Continue disposes the presentation.
5. A fresh eligible account remains on `/` during offer/success acknowledgement, then enters `/onboarding` after Continue.
6. The offer and resume controls remain usable at 375px and 860px widths.

## Limits and release checks

- The database-backed payment integration suite is opt-in and was skipped. Its hard-coded test database is truncated by setup; it was not enabled against an unverified existing database. Before release, run concurrent blogger claims and ordinary-before-KOC / KOC-before-ordinary cases in a dedicated isolated PostgreSQL test database and confirm one grant per blogger entitlement.
- Browser API responses were controlled fixtures. Google OAuth, production Turnstile, real extension installation, Stripe and Apple calls were not exercised. Existing auth middleware tests verify campaign-preserving redirects; full-document reload was exercised directly. Recheck external integrations in staging using dedicated test accounts.
- An already-verified session can use previously synced offline local data. A fresh offline document conservatively waits for identity verification; cached profile data alone never authorizes onboarding or binds a promotion.
- Chinese and English copy is included. The touched UI uses Web semantic tokens and respects reduced motion. Browser visual checks covered the light profile; dark/e-ink were inspected for semantic-token compatibility, not given a complete visual pass. This change does not claim to migrate the rest of the legacy subscription UI to new theme profiles.

## Rollout and recovery

Deploy the additive API status response before the Web change. Older clients still read the existing boolean; newer clients accept old boolean-only replies and keep unknown unavailability retryable. No database migration is needed.

If the Web release must be rolled back, retain all reward receipts, entitlement periods and subscription credits. The older client can ignore the versioned pending-invitation record. Do not clear unrelated browser state or onboarding completion markers.

Users whose invitation was already lost should revisit the original KOC URL. Eligibility is determined by the server; an ordinary platform trial does not remove an unused blogger entitlement. No bulk grants or invented attribution are part of recovery.

When publishing, target `dev` and include `OpenSpec: koc-onboarding-continuity` in the PR body. Archive the change only after merge. This session does not deploy, push or merge the branch.
