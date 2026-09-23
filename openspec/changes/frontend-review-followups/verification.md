# Verification

Validated on macOS arm64 with Node.js 24.15.0 and pnpm 11.25.0, against dev at `4c3e26f`, on branch `fix/frontend-review-followups`.

## Environment and CI type checks

Each scenario used a clean worktree without local environment files. The process environment contained only PATH/HOME/TMPDIR, CI/tool telemetry settings, the development profile, and the scenario's explicit public values.

| Configuration | `pnpm web -- typecheck` | `pnpm extension -- typecheck` |
| --- | --- | --- |
| App variables absent | Failed: 11 TypeScript errors | Passed |
| Workflow app variables explicitly empty | Failed: 9 TypeScript errors | Passed |
| Existing workflow placeholder values | Passed | Passed |

The successful case used localhost Web/API URLs, `COOKIE_DOMAIN=localhost`, `COOKIE_TOKEN_NAME=slax_test`, and `GOOGLE_OAUTH_CLIENT_ID=ci-placeholder`, matching frontend-ci.yml. Optional OAuth, Turnstile, analytics, and push configuration was absent. No real service credentials or live backend were required.

Missing/empty required Web configuration makes schema parsing fall back to a partial object; generated runtimeConfig types then lack typed cookie and push fields. This is existing local configuration behavior, not a new runtime change. CI retains its valid public placeholders and now runs the actual Web typecheck and Extension compile scripts, including their preparation lifecycle hooks. Extension typecheck success without configuration does not imply runtime login or API access will work.

## Installation, tests, and builds

- Removed only this worktree's node_modules directories and installed with `pnpm install --frozen-lockfile --side-effects-cache=false`. Installation succeeded with protobufjs/sharp lifecycle scripts blocked and no lockfile changes.
- Tested installed Sharp versions with PNG encode/decode and protobufjs with message encode/decode; all passed without the blocked scripts.
- `pnpm test:preflight`: 35 passed, including repeated SIGINT/SIGTERM forwarding and interrupted SSR startup.
- `pnpm extension -- test`: 16 passed, including both public Axios import/transport regression tests.
- `pnpm web -- test`: final run 1,771 passed, one existing smoke test skipped.
- Both `pnpm web -- build` and `pnpm extension -- build` passed with public placeholder configuration after the clean installation.
- `openspec validate --all --strict`: 8 passed, 0 failed.
- `git diff --check`: passed.

The initial Web test run failed 17 bookmarks integration assertions; an unchanged rerun passed. Inspection found two mocks for `@vueuse/core`: `mockNuxtImport('useScroll')` expands to a module mock while the suite also supplies a direct module mock for infinite scroll. Consolidated these into one factory so scroll simulation cannot replace initial-load simulation. The final full test run passed with the consolidated mock. No application behavior, assertions, or timeout limits were changed to address this test issue.

## Local review

No Important findings after Bugs, Security, and Compliance passes. The matching change-id is `frontend-review-followups`; the other active changes describe the prior migration, deploy configuration, or backend commands.

- Bugs: checked public exports, child-listener cleanup and interruption status, lifecycle preparation before typechecks, and the duplicate test mock.
- Security: no new network transport, logging of credentials, or committed local environment files; the dependency script allowlist is narrower.
- Compliance: implementation and completed tasks match this change; the test mock cleanup is an implementation-only validation fix. Historical migration changes and PR metadata are untouched.

Linux GitHub Actions execution and platforms requiring a custom Sharp source build have not been validated locally. These local results do not establish remote CI status; consult the pull request checks for that. This task does not perform browser/backend integration acceptance.
