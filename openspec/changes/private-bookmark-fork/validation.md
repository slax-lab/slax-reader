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
- CI follow-up Nit fixes were covered by API PDF revision, Fork lineage, and rate-limit tests (64 focused API tests passing) plus Web PDF/cache tests (14 passing): empty PDF revisions now have the same semantics on API and Web, legacy bookmarks avoid an unnecessary lineage query, Fork requests use the bookmark-save limiter, and `/b/<uuid>` matching is shared by Web cache and visit tracking.

## Running behavior exercised

- Two local development accounts successfully Forked Reader snapshots owned by another account.
- A human reviewer ran the local Web smoke test on 2026-10-21: opened another user's shared `/b/<uuid>` snapshot, clicked the visible Fork action, verified the copied private bookmark and Source/Fork attribution, and then overwrote it through Add URL to confirm newest-data-wins. No UI adjustment was needed after the check.
- A Forked bookmark was overwritten through the normal URL-save path, confirming the same-user same-URL newest-data-wins behavior.
- A forced post-`begin()` Fork publication failure was exercised; a new target is marked `failed` under its write-version fence, while an overwrite target keeps its previously committed body readable.
- The local R2 cleanup job was triggered manually and the retired object lifecycle was inspected.

## Remaining gaps

- No production deployment or production database migration was performed in this change.
- Physical mobile-device repetition is out of scope for this change; the mobile browser path uses the same responsive Web Fork action and API contract, while the local acceptance above covers the visible Web surface.
- Cloudflare scheduled execution remains environment-dependent; local `pnpm api -- dev` does not itself invoke scheduled events unless the local Worker runtime is configured or the handler is triggered explicitly.
