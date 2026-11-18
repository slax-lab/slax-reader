# Validation

## Scope and authorization

On 2026-11-18 the change requester explicitly chose a code-only backend PR first: internal addresses do not receive email; backend logs provide the code for colleague testing. Link logging remains in the later feature. The isolated branch starts at dev `b3d0f693` and changes only the existing API constant/domain service, affected tests and OpenSpec records. No client, contract, native integration, package version, migration, new endpoint or configuration is changed. No UI acceptance checkpoint applies.

## Automated evidence

- Baseline: email-code and layer suites, 47 passed.
- Red/green: three new internal-login cases failed with `EMAIL_AUTH_UNAVAILABLE` before implementation and passed after it. Exact-domain/login-purpose exclusions and failures before log emission are covered.
- Final focused regression: `EMAIL_OTP_REDIS_TEST=1 pnpm api -- test test/domain/emailCode.test.ts test/infra/emailChallengeRedis.integration.test.ts test/script/layerArchitecture.test.ts` with the existing task-local Redis binaries on PATH: 71 passed, no skips (22 domain, 14 real-Redis integration, 35 layer checks).
- `pnpm api -- typecheck`: passed. Scoped ESLint for both runtime source files: passed.
- `pnpm api -- gen:all`: passed using the tracked example config, synthetic local database URLs and dotenv disabled; the API formatter was explicitly selected. Generated artifacts have no final tracked drift.
- `pnpm exec openspec validate --all --strict`: 152 passed, zero failed. `git diff --check`: passed.

## Running environment

`EMAIL_AUTH_HTTP_SMOKE=1 pnpm api -- test:http` passed with isolated PostgreSQL, disposable Redis/Upstash HTTP transport and the actual Core Worker/DI/router/session path. For `Internal-Reader@INTERNAL.INVALID`, the smoke read the six-digit code from actual Worker logs, verified no captured Resend delivery, checked unchanged response fields, signed in via existing `/v1/user/login`, verified the mailbox binding and rejected code replay. Existing ordinary email, binding, Passkey and broader HTTP smoke assertions also passed. Initial fixture-only failures were corrected (missing fixture authorization and the expected preserved display casing); no product behavior was changed to satisfy those assertions.

Local receipts: `/tmp/slax-internal-email-20261118/` (`baseline.log`, `red.log`, `regression.log`, `type.log`, `lint.log`, `gen.log`, `http.log`, `openspec.json`). The first runtime attempt lacked Redis on PATH; the final run reused the prior task's built Redis binaries. No operator secrets were read and no real email was sent.

## Local pre-push review

Read REVIEW.md and reviewed all changed files in its three passes. No Important findings remain.

- **Bugs:** normalized exact-domain selection, purpose separation, unchanged provider rejection/ambiguity handling, shared limits, expiry and single-use verification are preserved. Logging happens only after successful challenge save.
- **Security:** the explicitly requested log exception is limited to internal login addresses; ordinary and binding codes are not logged by this branch. No credential appears in the send response. No new network access, dependency or secret configuration is introduced.
- **Compliance:** change ID `log-internal-email-login`; matches the revised code-only request. Naming, constant placement, DI and controller → domain → infra call order are preserved; Redis/SQL ownership and layer baseline are unchanged. No unrelated formatting or client refactor is included.

## Remaining verification

Live Worker publication and colleague testing await the requester's normal merge/release. App links and actual Resend delivery are outside this urgent PR and remain in the separate email-link feature's acceptance work.
