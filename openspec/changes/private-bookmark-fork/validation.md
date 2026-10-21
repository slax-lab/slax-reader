# Validation

## Automated checks

The implementation was validated with the following checks before opening the pull request:

- API focused Fork, publication, cleanup, URL-save, and PDF tests passed.
- Follow-up API review tests passed: 36 tests across Fork service and import flows; Web Fork-button tests passed: 5 tests.
- API full suite passed with 198 tests passed and 12 skipped.
- Web Fork, PDF, and cache focused tests passed with 22 tests passed before the follow-up changes; the follow-up Fork-button suite passed with 5 tests.
- API typecheck passed.
- Web typecheck was attempted; the local baseline currently reports 10 unrelated errors in `useAuth`, `useNotification`, the auth middleware, the user store, and request utilities. No error points to the Fork component or its test.
- API lint passed with no errors; the reported warnings were pre-existing.
- `git diff --check` passed.
- `openspec validate --all --strict` passed with 52 items passed and 0 failed.
- The local Bugs, Security, and Compliance review found no Important findings.

## Running behavior exercised

- Two local development accounts successfully Forked Reader snapshots owned by another account.
- A human reviewer ran the local Web smoke test on 2026-10-21: opened another user's shared `/b/<uuid>` snapshot, clicked the visible Fork action, verified the copied private bookmark and Source/Fork attribution, and then overwrote it through Add URL to confirm newest-data-wins. No UI adjustment was needed after the check.
- A Forked bookmark was overwritten through the normal URL-save path, confirming the same-user same-URL newest-data-wins behavior.
- The local R2 cleanup job was triggered manually and the retired object lifecycle was inspected.

## Remaining gaps

- No production deployment or production database migration was performed in this change.
- Physical mobile-device repetition is out of scope for this change; the mobile browser path uses the same responsive Web Fork action and API contract, while the local acceptance above covers the visible Web surface.
- Cloudflare scheduled execution remains environment-dependent; local `pnpm api -- dev` does not itself invoke scheduled events unless the local Worker runtime is configured or the handler is triggered explicitly.
