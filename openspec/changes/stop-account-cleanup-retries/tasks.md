# Tasks

## 1. Stop automatic account-cleanup replay

- [x] 1.1 Remove the deleted-account recovery cron source and regenerate backend registration through `pnpm api -- gen:all`; verify the generated schedule/DI diff removes only this job and preserves unrelated five-minute tasks. Registration generators passed twice with identical hashes; full generation's temporary-directory cleanup gap is recorded in `validation.md`.
- [x] 1.2 Make the initial account-deletion consumer log and return on cleanup failure; exercise the generated queue dispatcher with a failed first delivery and a successful second delivery, asserting acknowledgements, no retry requests, no duplicate cleanup calls, and continued batch processing.
- [x] 1.3 Preserve initial cleanup success and account revocation; run focused deletion/access tests confirming the tombstone, invalid credentials, revoked sessions, and deleted-account checks remain effective after a cleanup failure.

## 2. Verify and deliver

- [x] 2.1 Exercise the changed queue and scheduled paths in an isolated running Worker with synthetic failing cleanup and observed Workflow admissions; run multiple former recovery intervals and assert old deleted accounts cause no cleanup calls or vector dispatch. Record commands, results, and any agent-executable gap in `validation.md` without replaying production data. Admissions are synthetic counters; production provider I/O is explicitly outside the fixture.
- [x] 2.2 Run focused API checks, `pnpm api -- test test/script/layerArchitecture.test.ts`, generator drift checks, and `openspec validate --all --strict`; record their actual results and resolve task-introduced failures. Full-suite and wrapper exit limitations are declared verification gaps, not passing results.
- [x] 2.3 Complete the Bugs, Security, and Compliance pre-push review, including naming/layers/generated files/necessary complexity; verify the task PR targets dev and includes `OpenSpec: stop-account-cleanup-retries` plus the evidence trail. Do not auto-merge or deploy.
