# Tasks

## 1. Credential issuance

- [ ] 1.1 Issue tokens with one integer-second timestamp and an expiration exactly 86,399 seconds later; verify actual signed claims and expiration boundaries in a focused backend regression test.

## 2. Verification and delivery

- [ ] 2.1 Regenerate backend artifacts and verify no unrelated generated changes; run the focused token and existing sync tests, backend typecheck, and `openspec validate --all --strict`.
- [ ] 2.2 Complete the Bugs, Security, and Compliance review from REVIEW.md, resolve Important findings, and create the PR targeting dev with `OpenSpec: powersync-token-24h`.
