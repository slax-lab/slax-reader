# Tasks

## 1. Atomic save

- [x] 1.1 After proposal review, establish an isolated `fix/fix-bookmark-share-save` task branch from `origin/dev`; verify branch ancestry and preserve unrelated working changes.
- [x] 1.2 Add failing service and PostgreSQL-backed repository regressions for immediate off/on saves, a stale absent result despite an existing row, overlapping initialization, disabled shares and retained identity/code/time; verify failures against the old implementation before editing product code.
- [x] 1.3 Implement a parameterized native upsert through `this.prismaPg().$queryRaw` and remove the service's existence-dependent branches; verify the regressions pass, admission failures do not write, UID/legacy responses remain compatible and observed SQL contains `ON CONFLICT (bookmark_id, user_id) DO UPDATE` with `RETURNING`.

## 2. Verification and delivery

- [x] 2.1 Run `pnpm api -- gen:all`, inspect generated drift, and run relevant API tests, lint, typecheck and `openspec validate --all --strict`; record actual results and any unrelated blockers.
- [x] 2.2 Exercise the real local Edge/Core endpoint against a disposable database with the repository migrations: initialize and toggle empty/commented/existing shares, verify stored flags and a single row, and record results plus the cloud-cache verification gap in `validation.md`.
- [x] 2.3 Run the Bugs, Security and Compliance review from `REVIEW.md`; record the application-version applicability decision before implementation handoff, and obtain human hands-on acceptance of the existing toggle flow before opening a PR. Verify all applicable delivery requirements are recorded; do not deploy, merge or archive this task automatically.
