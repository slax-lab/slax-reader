# Tasks

## 1. Credential issuance

- [x] 1.1 Issue tokens with one integer-second timestamp and an expiration exactly 86,399 seconds later; verify actual signed claims and expiration boundaries in a focused backend regression test.

## 2. Verification and delivery

- [x] 2.1 Regenerate backend artifacts and verify no semantic generated changes; run the focused token and existing sync tests, backend typecheck, and `openspec validate --all --strict` against a clean tracked-file snapshot.
- [x] 2.2 Complete the Bugs, Security, and Compliance review from REVIEW.md, resolve Important findings, and create the PR targeting dev with `OpenSpec: powersync-token-24h`.

## 3. Mobile contract alignment

- [x] 3.1 Align the mobile lifetime diagnostic with 86,399-second issuance while retaining the independent 24-hour cache ceiling; verify the existing credential-recovery test covers 86,399, 86,400, and 300-second credentials with the expected warning behavior and unchanged ownership checks.
- [x] 3.2 Update compatibility documentation and planning artifacts to distinguish historical 300-second live evidence from the new issuance policy; verify that historical evidence files remain unchanged.
