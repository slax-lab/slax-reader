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

## Chloe extension

- [x] 4.1 Add `chloemanilay` with the supplied name (`Chloe`), avatar URL, and activity ID while preserving all 13 profiles present before this extension.
- [x] 4.2 Run API typecheck and lint, confirm `add-koc-bloggers` remains the sole active change for `blogger-promotions`, and run strict OpenSpec validation.

This extension keeps `add-koc-bloggers` as the sole active change for `blogger-promotions` to avoid a second concurrent delta for the same capability.

## Sen LinkedIn and Substack extension

- [x] 5.1 Add `senlinkedin` and `sensubstack`, both using Sen's existing name (`Sen`) and avatar URL, while preserving all 14 profiles present before this extension.
- [x] 5.2 Run API eslint on the touched file, confirm `add-koc-bloggers` remains the sole active change for `blogger-promotions`, and run strict OpenSpec validation.
- [x] 5.3 Exercise the registry lookup and claim-validation logic from the real compiled module (`PromotionController.BLOGGER_RECORD` hasOwnProperty lookup and the `/receive` activity-id guard) for `senlinkedin`, `sensubstack`, and an unregistered id; record results in `validation.md`.

This extension keeps `add-koc-bloggers` as the sole active change for `blogger-promotions` to avoid a third concurrent delta for the same capability. The full HTTP smoke harness (`pnpm api -- test:http`) could not run in this environment because its Postgres fixture requires Docker at `/var/run/docker.sock`, while this host runs OrbStack's daemon at `~/.orbstack/run/docker.sock` with no `DOCKER_HOST` passthrough in the harness's isolated environment; this is a pre-existing environment gap unrelated to this change's diff, declared here per `docs/DEFINITION-OF-DONE.md` rather than worked around by editing the test harness.
