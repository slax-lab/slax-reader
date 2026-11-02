# Tasks

## 1. Proposal review

- [x] 1.1 Record human proposal approval in `proposal.md` before implementation.

## 2. Resolution and regression coverage

- [x] 2.1 Add a regression for `https://pca.st/6rpkp8cj` through the real resolver; record its failure before the fix.
- [x] 2.2 Add `pca.st` to the existing resolver domain list; verify the regression passes and resolved episode classification succeeds.
- [x] 2.3 Cover show redirects, missing redirects, resolution errors, and unsafe destinations; verify existing short-link tests still pass.
- [x] 2.4 Exercise workflow routing for the short link with Labs enabled and disabled; verify capture calls and annotation protection.
- [x] 2.5 Verify recapture retains bookmark identity and canonical capture retains episode identity with focused tests.

## 3. Verification and PR

- [x] 3.1 Exercise the real short-link redirect and podcast capture in a running environment; record player, playback, and transcript outcomes separately. Production persistence and transcription gaps are recorded in `validation.md`.
- [x] 3.2 Run API tests, typecheck, lint, required generation, strict OpenSpec validation, and diff checks; record results in `validation.md`.
- [ ] 3.3 Prepare a running preview and record human hands-on acceptance before PR creation, including reviewer, date, and adjustments.
- [ ] 3.4 Run the Bugs, Security, and Compliance review passes; resolve Important findings and record the review.
- [ ] 3.5 Open one PR targeting `dev` with the repository template, evidence, and `OpenSpec: resolve-pocket-casts-short-links`.
- [ ] 3.6 Address Agent review findings and CI failures until the current PR head passes the Agent review gate; leave human review pending.
- [ ] 3.7 After the task PR merges, classify unchecked tasks and archive through a documentation PR after the earlier Pocket Casts deltas.
