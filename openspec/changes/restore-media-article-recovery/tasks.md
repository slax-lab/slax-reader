# Tasks

## 1. API recovery

- [x] 1.1 Reproduce missing headers with controller and helper tests, then preserve defaults and pass the tests.
- [x] 1.2 Add owner-only unavailable reasons and verify Labs, missing source, visitor, moderation, and snapshot cases.

## 2. Web recovery

- [x] 2.1 Reproduce initial polling failures in both views, then show retry and owner guidance with passing component tests.
- [x] 2.2 Exercise both views in a running browser across themes and narrow widths; record evidence and limits.

## 2A. Transcript readability

- [x] 2A.1 Reproduce fragmented caption layout; group cues without changing source text or highlight paths.
- [x] 2A.2 Verify the real reported transcript in the local reader across themes and widths; show screenshots.

## 2B. Edited YouTube reading

- [x] 2B.1 Add failing checks for omitted cues, translation structure, full-article introduction, and disabled-generation reads.
- [x] 2B.2 Implement versioned editing, translation, complete coverage, and introduction generation within existing limits.
- [x] 2B.3 Add article navigation, reading styles, and source notes to saved and separate article views.
- [x] 2B.4 Distinguish failed body publication from complete generation and preserve ready reads.
- [x] 2B.5 Exercise real generation and saved local article reading; inspect desktop and mobile screenshots.
- [x] 2B.6 Run focused regression checks and record verification limits.

## 3. Review and delivery

- [x] 3.1 Run focused tests, type checks, lint, strict OpenSpec validation, and the three local review passes; record results.
- [ ] 3.2 Obtain colleague hands-on acceptance; record who, when, and adjustments. Luca authorized PR creation first on 2026-10-27.
- [ ] 3.3 Archive through a documentation PR after this task PR merges and after the merged bookmark-fork deltas are archived.
