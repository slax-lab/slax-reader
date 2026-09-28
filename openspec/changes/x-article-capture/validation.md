# Validation

## Implementation evidence

- Added 33 regression tests in `apps/api/test/flow/addUrl/14-twitterArticleCapture.test.ts`. The initial 29 cases produced 22 expected failures on the old implementation; all 33 cases pass on the final implementation.
- The tests exercise real article discovery, provider selection, HTML parsing, and persistence, with provider requests and storage mocked. They cover the reported status/internal article IDs, provider ordering, unusable responses, direct article URLs, bounded short links, source preservation, and tweet media/quote fallback.
- All add-URL flow tests, HTML builder tests, and platform detector tests pass in the complete backend run.
- `pnpm api -- typecheck`: passed.
- `pnpm api -- lint`: exited successfully, with 336 warnings. The changed service also passes targeted ESLint with no errors.
- API Prettier checks for the changed service and new tests: passed.
- `openspec validate --all --strict`: 17 items passed.
- `git diff --check`: passed.

## Complete backend suite

Final run: **1,596 passed, 91 failed, 46 skipped**. This is not a green suite. No tests were disabled or changed to work around environment restrictions.

The initial sparse checkout omitted public deployment fixtures. Restoring only the non-secret tracked fixtures removed the missing-file failures. Remaining failures are in these suites:

| Test file under `apps/api/test/` | Failed tests | Observed blocker |
| --- | ---: | --- |
| `script/deployPaths.test.ts` | 3 | Temporary-directory cleanup returns EPERM |
| `script/devLocal.test.ts` | 11 | Temporary-directory cleanup returns EPERM |
| `script/envFiles.test.ts` | 12 | Sandbox denies test `.env` fixtures |
| `script/generatorPaths.test.ts` | 1 | tsx IPC socket creation returns EPERM |
| `script/rootCommands.test.ts` | 6 | Temporary-directory cleanup returns EPERM |
| `script/rootDeployment.test.ts` | 12 | tsx IPC socket creation and temporary-directory cleanup return EPERM |
| `script/setupApi.test.ts` | 23 | Sandbox denies test `.dev.vars` fixtures |
| `script/setupBackend.test.ts` | 19 | Test environment fixtures and temporary-directory cleanup return EPERM |
| `script/workerTypesSecurity.test.ts` | 2 | Temporary-directory cleanup returns EPERM |
| `utils/publicFetch.test.ts` | 1 | Local HTTP fixture cannot listen; test times out |
| `handler/http/imageProxy.test.ts` | 1 | Local HTTP fixture cannot listen; test times out |

The last two suites also produce unhandled `listen EPERM` errors. Rerun `pnpm api -- test` in the normal development or CI environment before merging.

## Generated artifacts

`apps/api/AGENTS.md` requires `pnpm api -- gen:all` for service changes. It remains outstanding: its Prisma configuration loads `deploy/local/.env`, which this session is prohibited from reading. The narrower `pnpm api -- gen:di` was attempted and failed before execution because tsx could not create its IPC socket. No generated artifacts were manually patched. The service constructor and dependency registrations are unchanged.

## Local review

Reviewed the final diff using the three passes in `REVIEW.md`, with OpenSpec change `x-article-capture`:

- Bugs: no Important code findings remain; fallback order, IDs, persistence, and ordinary tweet output are covered.
- Security: article discovery validates HTTP(S), exact X/Twitter hostnames (including existing www aliases), and article paths. Short-link requests are deduplicated and bounded; full tweet bodies and credentials are not added to diagnostics.
- Compliance: implementation matches the approved detection → fxembed → article API → original tweet flow. Fetch results remain serializable and the bookmark source is retained.

No deployment or live bookmark recrawl was performed. Existing cached bookmarks require an explicit recrawl after deployment; these unit tests do not substitute for a live provider check.
