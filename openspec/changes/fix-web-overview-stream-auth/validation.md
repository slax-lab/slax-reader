# Validation

## Automated checks

Run on 2026-11-24 from `fix/fix-web-overview-stream-auth`, based on `origin/dev` at `3ff1b2e1`.

- The two targeted Vitest files passed all 60 tests. Before the fix, the HTTP rejection, visitor gating, invalid payload, and async-read cases failed as expected. Before the reader cleanup follow-up, the abort, terminal-state ownership, and in-progress indicator assertions failed as expected.
- `pnpm --filter @apps/slax-reader-dweb exec vitest run` passed 3,372 tests across 273 files. Three tests were skipped by the suite.
- `pnpm --filter @apps/slax-reader-dweb type` and `pnpm --filter @apps/slax-reader-dweb exec vue-tsc --noEmit -p .nuxt/tsconfig.app.json` passed.
- ESLint on the four changed Web files reported zero errors and two existing warnings in the request test setup. The full Web lint command reported 82 import-sort errors in untouched files.
- `pnpm exec openspec validate --all --strict` passed all 169 items. `git diff --check` passed.

## Running Web verification

Playwright drove Chrome against the running Nuxt development server. A temporary Nuxt layer supplied snapshot metadata and article HTML for the real `/b/:id` route. An actual local HTTP fixture server supplied responses to `POST /v1/bookmark/overview`, including multiple network chunks for the success case. The session cookie and authorizations were synthetic.

| Scenario | Observed result |
| --- | --- |
| Anonymous visitor opened a public snapshot with a cached outline | The outline rendered and the overview section stayed hidden. Browser requests and the HTTP fixture both recorded zero overview POSTs. |
| Signed-in owner received HTTP 401 with a JSON error body | The overview POST included the fixture authorization and ran once. The app removed the session cookie on the reader route, reached `/login`, and left no overview loading indicator or unhandled rejection. |
| Signed-in owner received the normal HTTP 200 stream | The overview text and both takeaways appeared. The server sent the overview frame in three chunks. The done frame cleared the loading indicator, with one POST and no retry or unhandled rejection. |
| Signed-in owner received an error envelope inside HTTP 200 | The existing retry control appeared and loading ended. The session remained present, one POST ran, and no unhandled rejection occurred. |

The visitor scenario ran at 1440 px, where the visitor has an Analysis entry. The three owner scenarios passed at 1440, 768, and 390 px using the desktop and mobile controls. Browser checks confirmed the applicable outline, completed overview, or retry control was visible in light, dark, and e-ink.

The PR visual pair captures the Analysis panel in light theme at 1440 × 900 with the same HTTP 200 invalid-envelope fixture. The base component left the skeleton visible after an unhandled rejection. The fixed panel showed the retry control and retained the cached outline.

Production API behavior and the identity of the original logged request remain outside these fixture results.

## Local review and acceptance

The Bugs pass found two reader lifecycle issues. Follow-up tests verified that failed reads abort their request and that a late failure from a settled request leaves the next retry's loading state intact. The re-review found no remaining Important code findings. The Security pass confirmed the API access policy and error envelope stay in place. The Compliance pass matched the behavior and evidence to this approved change.

The change requester confirmed hands-on acceptance of the implemented Web overview fix in conversation on 2026-11-24 and authorized opening the task pull request. No adjustments were requested.
