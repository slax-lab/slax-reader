# Tasks

## 1. Reproduce the migrated-session failure

- [x] 1.1 Add scope-aware authentication regression tests using synthetic credentials for the `.r.slax.dev` to `slax.dev` migration and simultaneous cookie variants; run them before implementation and confirm the failure is that the legacy cookie remains readable.
- [x] 1.2 Cover configured-cookie-name isolation, existing parent-domain cleanup, host-only localhost sessions, absent cookies, and repeated cleanup; verify assertions inspect remaining cookies and user state rather than only removal-call counts.

## 2. Repair shared session termination

- [x] 2.1 Update `useAuth().clearAuth()` to expire the supported host-only and explicit-domain scopes, preserve safe non-browser/local-development behavior, and complete user-state cleanup; verify the authentication regressions pass.
- [x] 2.2 Await cleanup in the bookmarks user-menu logout handler before replace navigation; verify a component regression fails when navigation occurs before cleanup resolves and passes with the change.

## 3. Verify recovery and prepare the pull request

- [x] 3.1 Exercise actual auth cleanup with route middleware and the existing request/PowerSync 401 behavior; verify `/login` is allowed, subsequent credential attempts send no request with the removed token, and a fresh valid session can fetch credentials.
- [x] 3.2 Run the Web test suite, relevant lint/type checks, and `openspec validate --all --strict`; record results and any environment blockers accurately in `verification.md` for the PR validation notes.
- [ ] 3.3 Verify the supported cookie scopes and logout/login route outcome in Chrome using a disposable synthetic session; record the observed result without real account credentials or site-wide storage clearing.
- [x] 3.4 Run the local Bugs, Security, and Compliance review from `REVIEW.md` for `legacy-session-logout`, resolve Important findings, and create a PR targeting `dev` with `OpenSpec: legacy-session-logout` and reproducible test-environment verification steps; attach the created PR to this chat. PR: https://github.com/slax-lab/slax-reader/pull/206.
