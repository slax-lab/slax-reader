# Verification

## Automated results

Validation used a temporary copy of the current Web source and workspace packages, excluding secret configuration. A normal frozen-lockfile installation could not finish in the restricted environment: the global pnpm store index was not writable, and a writable temporary index lacked offline supply-chain metadata. The temporary copy therefore reused dependencies already installed for the legacy Web checkout. No dependency manifest, lockfile, or supply-chain policy was changed. CI with a complete frozen-lockfile installation remains necessary.

- Before implementation, the new regressions failed for retained legacy/duplicate cookies, early completion of user-state cleanup, a second rejected credential request, and early Logout navigation.
- After implementation, the five targeted test files passed: **66 tests** across authentication cleanup, the bookmarks user menu, route middleware, the shared request client, and the PowerSync connector.
- Changed-file ESLint passed without errors or warnings.
- The full Web suite reported **181 passed files, 4 failed files, and 1 skipped file**; **1,915 passed tests, 9 failed tests, and 1 skipped test**.
- All four failed files reproduced their failures with the unmodified base production code: `pdfGeometry.spec.ts` and `Selection/modal.spec.ts` encountered unsupported TypeScript parameter properties in strip-only mode; `pdfViewport.spec.ts` could not resolve `pdfjs-dist/legacy/build/pdf.mjs`; nine `mermaid.spec.ts` cases could not resolve `mermaid`.
- Type checking did not pass in this temporary environment. Its output was byte-for-byte identical with modified and unmodified production code, including missing PDF dependencies and existing `$t` typing diagnostics.
- `openspec validate --all --strict` passed all **33** items.
- `git diff --check` passed.

Targeted command, from `apps/web` with the repository's public test configuration available:

```sh
pnpm exec vitest run tests/unit/composables/useAuth.spec.ts \
  tests/unit/components/BookmarkList/BookmarksUserMenu.spec.ts \
  tests/unit/local-first/connector.spec.ts \
  tests/unit/middleware/auth.global.spec.ts \
  tests/unit/utils/request.spec.ts
```

## Browser status

The original failure was reproduced in Chrome with a disposable cookie: a cookie explicitly scoped to the current hostname survived host-only removal. The post-change browser check was blocked during validation by the locked Mac and a restricted environment that prevented a local browser-test server from binding a port. This check remains pending. Automated tests model the observed scope distinction, but do not replace verification of the deployed application.

## Local pre-push review

An independent reviewer inspected the implementation and regression tests against base commit `cb3d7eac70e5405f0ef8e0fdd8a9c2a18cb265a1`, following the Bugs, Security, and Compliance passes in `REVIEW.md`. The selected OpenSpec change was `legacy-session-logout`. The review reported no Important findings or actionable Nits. It inspected the validation evidence but did not rerun tests or verify Chrome behavior.

## Test deployment verification

1. Deploy the PR's Web build to the test environment with its existing cookie configuration.
2. In a browser profile containing an existing migrated session, open `/bookmarks` and select Logout. Confirm the page stays on `/login` and no login-cookie variant remains at path `/` for the host-only, `.r.slax.dev`, or `.slax.dev` scopes.
3. With a separate rejected legacy session, allow `/v1/sync/token` to return 401. Confirm the page reaches `/login`; after cleanup, no new credential request uses that removed session. Requests already in flight may still complete with 401.
4. Sign in again. Confirm the fresh session can retrieve PowerSync credentials and synchronization connects.
5. Inspect cookie names, domains, paths, and request status only; do not paste account tokens into issues or test fixtures. Do not clear site-wide storage as part of the test.
