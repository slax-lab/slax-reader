# Tasks

## 1. Registry update

- [x] 1.1 Retain the user-supplied additions for `yianggao`, `corina`, `hopeseventeen`, and `senl`; verify their names, avatar URLs, and activity IDs against the spec and confirm existing records are unchanged.
- [x] 1.2 Add `siderealedu` with the supplied name, avatar URL, and activity ID while preserving all 12 profiles present before this extension.

## 2. Verification and review

- [x] 2.1 Verify TypeScript parsing and transpilation and check the diff for whitespace errors.
- [x] 2.2 Validate all OpenSpec artifacts with `pnpm exec openspec validate --all --strict` and perform the Bugs, Security, and Compliance passes from `REVIEW.md`.
- [ ] 2.3 Obtain human review of the proposal and supplied implementation in the pull request before merge.

## Initial four-profile validation

- The user supplied the implementation before this change record was created; this record documents its scope for review.
- A one-off TypeScript AST check confirmed the four additional records exactly match the spec and all eight previous records remain unchanged. TypeScript parsing and transpilation passed.
- Strict OpenSpec validation passed for all 37 items. The local Bugs, Security, and Compliance review used change ID `add-koc-bloggers` and found no Important implementation findings; human proposal review remains pending.
- `pnpm api -- test` was attempted: 877 tests passed, 128 failed, and 11 were skipped; 86 test files failed, 76 passed, and 4 were skipped. The run also reported two unhandled errors. Reported blockers include unavailable generated Prisma clients and sandbox-denied fixture file access and local port binding. The full suite is not verified in this environment.
- `design.md` is omitted because this is a static registry expansion with no architectural decisions or migration work.

## Sidereal Education extension

- [x] 3.1 Verify the supplied profile and unchanged existing records, confirm a single active `blogger-promotions` delta, run strict OpenSpec validation, and repeat the Bugs, Security, and Compliance review.

This extension uses `add-koc-bloggers` as the sole active change for `blogger-promotions`. The separate `add-sidereal-education-blogger` proposal, specs, and tasks are folded into this change to resolve the duplicate capability finding on PR #243.
