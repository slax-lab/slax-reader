# Tasks

## 1. Extend the annotation check

- [x] 1.1 Run the Pocket Casts workflow tests for a Xiaoyuzhou link too; verify the annotated case fails on `dev`.
- [x] 1.2 Check annotations before every podcast recapture fetch; verify both sources pass and Labs off never checks.

## 2. Verify and hand off

- [x] 2.1 Run API type check, lint, tests, and `openspec validate --all --strict`; record results in `validation.md`.
- [ ] 2.2 After deployment, save an annotated non-Pocket Casts podcast bookmark again on `dev`; verify the body and highlights stay and the bookmark is readable.
- [ ] 2.3 Archive through a documentation PR after this PR merges, after `add-bookmark-fork` and `capture-pocket-casts`; classify unchecked tasks first.
