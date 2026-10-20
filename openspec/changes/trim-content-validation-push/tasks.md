# Tasks

## 1. Trim the validation card

- [x] 1.1 Replace the multi-line parser comparison with a one-line completeness summary in `apps/api/src/utils/articleQualityScoring.ts`, keeping the unavailable-score fallback.
- [x] 1.2 Remove the confidence and evidence fields from the Content Validation result card while keeping the screenshot preview link, issue-type gating, and step events unchanged.
- [x] 1.3 Update the workflow and formatter tests to assert the trimmed card and the parser-labeled summary.

## 2. Validation and review

- [x] 2.1 Run the targeted API tests and applicable static checks, validate OpenSpec strictly, and complete the Bugs, Security, and Compliance pre-push review with no Important findings. Record results in `validation.md`.
