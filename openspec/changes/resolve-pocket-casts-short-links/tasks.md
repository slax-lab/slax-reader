# Tasks

## 1. Proposal review

- [x] 1.1 Record human proposal approval in `proposal.md` before implementation.

## 2. Resolution and regression coverage

- [x] 2.1 Add a regression for `https://pca.st/6rpkp8cj` through the real resolver; record its failure before the fix.
- [x] 2.2 Add `pca.st` to the existing resolver domain list; verify the regression passes and resolved episode classification succeeds.
- [x] 2.3 Cover show redirects, missing redirects, resolution errors, and unsafe destinations; verify existing short-link tests still pass.
- [x] 2.4 Exercise workflow routing for the short link with Labs enabled and disabled; verify capture calls and annotation protection.
- [x] 2.5 Verify recapture retains bookmark identity and canonical capture retains episode identity with focused tests.

## 2a. Concurrent readable articles

- [x] 2a.1 Add failing concurrency, ordering, retry, and budget regressions.
- [x] 2a.2 Process five independent editing and translation chunks with reserved cost accounting.
- [x] 2a.3 Run focused tests and API checks; record runtime verification limits.

## 2b. Complete reading presentation

- [x] 2b.1 Reuse YouTube reading styles and chapter navigation for original and translated podcast articles.
- [ ] 2b.2 Test rendering, navigation, and playback; verify themes and responsive widths.
- [ ] 2b.3 Generate and display the full real episode article before requesting acceptance.

## 3. Verification and PR

- [ ] 3.1 Exercise the complete capture in a running environment. Verify that the full episode transcript becomes the bookmark body. Redirect resolution and audio playback alone do not satisfy this check.
- [x] 3.2 Run API tests, typecheck, lint, required generation, strict OpenSpec validation, and diff checks; record results in `validation.md`.
- [x] 3.3 Record Luca's 2026-11-02 acceptance of the complete raw-transcript guest page and PR submission. Preserve the generated-article verification gaps.
- [x] 3.4 Run the Bugs, Security, and Compliance review passes; resolve Important findings and record the review.
- [x] 3.5 Open one PR targeting `dev` with the repository template, evidence, and `OpenSpec: resolve-pocket-casts-short-links`.
- [ ] 3.6 Address Agent review findings and CI failures until the current PR head passes the Agent review gate; leave human review pending.
- [ ] 3.7 After the task PR merges, classify unchecked tasks and archive through a documentation PR after the earlier Pocket Casts deltas.
