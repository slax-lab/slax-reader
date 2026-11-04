# Tasks

## 1. Regression coverage

- [x] 1.1 Add loader regression cases for 401, 403, 404, service/transport failures, and successful authorized metadata; demonstrate the 401/403 cases fail before the fix and assert rejected metadata never reads OSS.
- [x] 1.2 Add page recovery coverage for direct-entry hydration and client navigation, cleanup-before-reload ordering, supported cookie scopes, URL preservation, anonymous/private denial, no-cookie/header-only failures, cleanup failure, duplicate callbacks, and superseded sessions; demonstrate the current page fails the recoverable-cookie scenarios.

## 2. Content boundary and page recovery

- [x] 2.1 Preserve explicit authentication/access statuses through the loader rejection boundary without changing body authorization or genuine service-failure behavior; verify the loader regression cases pass.
- [x] 2.2 Implement a non-fatal cookie-rejection recovery state for SSR and client navigation, reuse existing session cleanup, and reload the same URL only after cleanup succeeds; verify page recovery cases pass with no competing detail initialization during recovery.
- [x] 2.3 Retain credential-bearing cache bypass and private/no-store recovery responses; run existing cache-isolation and PDF-delivery cases plus recovery-cache coverage to verify no private or recovery HTML enters the shared cache.

## 3. Verification and delivery readiness

- [x] 3.1 Run Web tests, lint, typecheck, build, and `pnpm exec openspec validate --all --strict`; record actual outcomes and any unrelated failures in `validation.md`.
- [x] 3.2 Exercise the running Web environment with synthetic invalid and expired cookie credentials on public and private snapshots, direct entry and client navigation, and host-only/domain cookie variants; record final status, cookie removal, URL retention, and reload count in `validation.md`, or explicitly declare any agent-executable gap and its cause.
- [x] 3.3 Prepare the running environment for human hands-on acceptance of the visible recovery behavior, implement requested adjustments, and record who accepted, when, and what changed before opening a PR.
- [ ] 3.4 Run the Bugs, Security, and Compliance local review passes in `REVIEW.md`, resolve Important findings, and verify the task PR to `dev` references `OpenSpec: recover-snapshot-expired-session` and the validation evidence; do not archive before merge.
