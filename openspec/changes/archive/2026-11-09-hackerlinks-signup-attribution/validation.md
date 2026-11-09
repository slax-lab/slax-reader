# Validation

## Scope

Validated the approved `hackerlinks-signup-attribution` implementation in the application worktree and its analytics companion worktree. The change adds no visible or accessibility-affecting UI; provider availability, login presentation, return targets, and account responses are preserved. No material-UX demo or visual hands-on acceptance path applies.

## Automated checks

- `pnpm --filter @slax-reader/contracts typecheck` — passed.
- `pnpm api -- test test/domain/collectionAuthAttribution.test.ts test/utils/deviceAlias.test.ts` — 2 files, 38 tests passed. Covered Google/Apple acquisition, new/returning accounts, collection compatibility, invalid and unknown fields, identity/method authority, device aliases, authentication failure, and analytics failure isolation.
- `pnpm api -- typecheck` — passed.
- `pnpm api -- lint` — completed with 0 errors and 344 existing warnings.
- `pnpm api -- gen:all` — passed after generating local configuration and using the repository's documented local PostgreSQL URLs for Prisma generation. No tracked generated-output diff resulted.
- Web focused tests, run with the synthetic public fixture configuration (`localhost` URLs, `slax_test` cookie, and fixture OAuth client IDs):
  `pnpm web -- test tests/unit/utils/acquisitionAttribution.spec.ts tests/unit/middleware/auth.global.spec.ts tests/unit/components/GoogleLoginButton.spec.ts tests/unit/components/AppleLoginButton.spec.ts tests/unit/components/global/LoginView.spec.ts tests/unit/composables/useAuth.spec.ts tests/unit/pages/auth.spec.ts tests/unit/pages/authAttribution.spec.ts tests/unit/pages/login.spec.ts` — 9 files, 101 tests passed, including direct-login page propagation.
- Web typecheck with the same synthetic configuration: `pnpm web -- typecheck` — passed.
- Focused Web ESLint over every changed TypeScript/Vue file — 0 errors; 5 existing `any` warnings in touched tests.
- Full `pnpm web -- lint` was also attempted. It fails on the unchanged baseline with 93 import-order errors and 437 warnings in unrelated files. No unrelated autofix was applied; the focused changed-file lint is the scoped result.
- `python3 apps/web/tests/fixtures/hackerlinks-attribution/query-fixture.py` — passed. Covered complete-triplet filtering, 300/301-second `effective_at` boundaries, UTC start/end boundaries, natural-key deduplication before interval filtering, an out-of-interval original with an in-interval redelivery copy, distinct users, ordinary/partial/unsupported/non-positive buckets, missing-device quality, group reconciliation, replay invariance, and repeatability.

## Running-environment checks

- Real Nuxt development application, synthetic provider configuration:
  `uv run --with playwright python apps/web/tests/fixtures/hackerlinks-attribution/browser-check.py` against `pnpm web -- dev --port 3215` — passed for `header`, `resource_detail`, and partial input. The actual `/` → `/login` navigation preserved only the complete UTM triplet and the existing return target; `utm_content` was absent.
- Actual callback Vue/composable/HTTP client and local synthetic provider/API boundaries:
  `uv run --with playwright python apps/web/tests/fixtures/auth-recovery/browser-check.py --base http://127.0.0.1:44020 --baseline http://127.0.0.1:44021 --output /tmp/slax-hackerlinks-auth-evidence` — 47 checks passed. Verified Google/header and Apple/resource-detail callback login bodies and fresh-authorization state, collection compatibility, cancellation/failure behavior, session/cookie behavior, and existing recovery matrix. No real provider account was contacted.
- Browser evidence was written only to `/tmp/slax-hackerlinks-auth-evidence`; no screenshots, raw events, account identifiers, or query exports were added to either repository.
- Analytics companion: local links resolved, `git diff --check` passed, only the five intended documentation files changed, and frozen `specs/tracking-plan-新用户激活.md` had no diff. Trino SQL uses `to_unixtime`; the 301-second example matches the normative threshold.

## Declared gaps and acceptance status

- **Task 5.2 — post-merge acceptance outstanding (real new accounts).** No authorized never-registered Google/Apple accounts or deployed non-production environment were available for the real-provider registration matrix. Fixture and local smoke checks do not satisfy that requirement.
- **Tasks 5.3 and 5.4 — post-merge acceptance outstanding (production environment and C5).** No production deployment, production account creation, production `logs.events` query, duplicate cohort report, or Alex C5 warehouse acceptance was performed.
- `user_created` and the Q6 attribution contract remain `proposed`; no `live` claim is made.
- `docs/release/VERSIONING.md` states that Web/API do not use package-version increments; CLI, Extension, and Mobile are unaffected, so no version decision is required.
- Tasks 5.2, 5.3, and 5.4 stay unchecked in `tasks.md`; archiving this change does not reclassify them as completed work.

## Review

- Independent Bugs / Security / Compliance review initially found one Important cross-boundary deduplication issue and one direct-login evidence Nit. The query now deduplicates the complete scoped set before UTC filtering, the exact counterexample passes in the fixture, and direct-login page tests were added.
- The same reviewer rechecked the actual files and confirmed both findings resolved, with no remaining Important findings and no Security findings. OpenSpec strict validation passed 108/108; both repositories' `git diff --check` passed.
- GitHub agentic review run 42196881340 completed successfully with no Important or Security findings. Its three Nits were addressed: the design query now explicitly ranks by earliest `effective_at`, PR text no longer claims Draft status, and the HackerLinks browser fixture accepts base URL and browser executable arguments.
- Follow-up agentic review run 42198221224 also passed with no Important or Security findings. Its three edge-case Nits were addressed by checking all acquisition literals in the type guard, making login attribution react to same-route query changes with regression coverage, and aligning design's null-timestamp cases with the Q6 plan and fixture.

## Delivery links

- Application PR targeting `dev`: https://github.com/slax-lab/slax-reader/pull/526 — merged 2026-11-06T10:15:48Z.
- Analytics companion PR targeting `main`: https://github.com/slax-lab/slax-reader-event-tracking/pull/2 — merged 2026-11-06T10:19:06Z.
- Both PRs were created ready for review and disclosed the real-provider and warehouse acceptance gaps. Merge does not imply deployment, production acceptance, or `live` lifecycle status.

## Archive classification (2026-11-09)

The archive evaluation reassessed the merged `dev` state rather than the original task session, and classified every task in `tasks.md`.

- **Source.** PR #526 (`feat/hackerlinks-signup-attribution`) merged into `dev` at 2026-11-06T10:15:48Z; analytics PR #2 merged into `main` at 2026-11-06T10:19:06Z. The archive branch starts from `origin/dev` at `e1fa706f`, a tip that contains the merged change directory and the shipped implementation.
- **Tasks 5.2, 5.3, and 5.4 — preserved unchecked as post-merge acceptance outstanding.** They require real never-registered OAuth accounts in an authorized non-production deployment, a production HackerLinks-entry cohort queried against a fixed `logs.events` snapshot, and Alex's analytics C5 acceptance. None existed at implementation time, and this archive evaluation cannot produce them. `user_created` and the Q6 definitions stay `proposed`.
- **Task 6.4 — pending at the first archive commit.** Its condition is the separate docs pull request that carries this archive; the check mark and that pull request's URL are recorded in a follow-up commit on the same branch after the pull request exists.
- **Tasks 1.1–6.3, excluding 5.2–5.4 — already checked with unchanged evidence.** No completed work is claimed without the evidence recorded above.
- **Capability sync.** `signup-acquisition-attribution` is a new capability. `openspec instructions specs --change hackerlinks-signup-attribution --json` returned valid artifact instructions with no rules, and the ADDED-only delta was merged inline, synchronously, into `openspec/specs/signup-acquisition-attribution/spec.md`: six requirements and 21 scenarios, `## Purpose` copied verbatim, no delta operation headers, and nothing else added. Verification before the archive: requirement and scenario counts match the delta, and `openspec validate --specs` passed 68/68.
- **No same-capability conflict.** No other active change carries a delta for `signup-acquisition-attribution` or references this change-id; the archive needed no ordering.
- **Q6 plan not archived here.** The analytics Q6 plan and decision live in `slax-lab/slax-reader-event-tracking`; their own all-live/no-pending-work condition is not satisfied while the definitions remain `proposed` and warehouse C5 evidence is missing.
- **Nothing dropped or narrowed.** No task was checked off, removed, or reworded to clear the archive.

## Archive outcome (2026-11-09)

- **Archive location.** `openspec/changes/hackerlinks-signup-attribution/` moved to `openspec/changes/archive/2026-11-09-hackerlinks-signup-attribution/` with its `.openspec.yaml` (`schema: spec-driven`, `created: 2026-11-06`) and delta spec intact. The active-changes list no longer contains the change.
- **Spec updates.** Created the living capability `openspec/specs/signup-acquisition-attribution/spec.md` from the six ADDED requirements — "Capture only a complete supported HackerLinks entry", "Preserve per-attempt attribution across both OAuth providers", "Attribute only the server-confirmed account-creation fact", "Keep telemetry collection and identity scope minimal", "Provide a deterministic registration-count query", and "Supersede the old scope without rewriting history" — with all 21 scenarios. No existing living spec was modified, removed, or renamed.
- **Task classifications.** 6.4 is checked off in the follow-up commit once the archive docs pull request exists; 5.2, 5.3, and 5.4 stay unchecked as post-merge acceptance outstanding; every other task keeps its prior checked state and evidence.
- **Validation.** `pnpm exec openspec validate --all --strict` printed `Totals: 116 passed, 0 failed (116 items)` with exit 0 after the archive. `git diff --check` exited 0. Post-archive requirement and scenario counts match the delta at 6/21, and the main spec contains no delta operation headers.
- **Remaining review considerations.** The merged application and analytics changes are documented as implemented but not live. Real-provider registration with never-registered accounts, the production HackerLinks-entry cohort, the fixed-snapshot `logs.events` query, reconciled Q6 breakdowns, and Alex's C5 acceptance remain unverified and are not implied by this archive. Merging the archive pull request is a human decision.
