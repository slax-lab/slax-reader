# Tasks

## 1. Preference-only tolerance

- [x] 1.1 Add user-preference coverage and skip absent source vectors while preserving strict Collection aggregation; verify partial article and Collection preference tests, same-set centered calculations and pagination after an entirely missing page.
- [x] 1.2 Preserve old profiles for all-missing eligible sources, retain deletion for empty history and fail on operational/invalid-vector errors; verify no unintended upsert/delete/provider calls occur.
- [x] 1.3 Preserve validated numeric coverage in operator summaries and existing HTTP result forwarding; verify malformed coverage cannot leak arbitrary fields and older responses remain supported.

## 2. Verification and delivery

- [x] 2.1 Exercise the real Service and task Controller chain in the existing local test runtime with missing-vector fixtures, verify partial writes and coverage, and confirm no source recovery or Jina calls.
- [x] 2.2 Run generation, API typecheck/lint/full tests, strict OpenSpec and four-Worker dry-run builds; record evidence and complete scoped Bugs/Security/Compliance review before delivering the fix PR to dev, without deploying or modifying live source data.
