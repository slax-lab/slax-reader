# Validation

Date: 2026-10-14. Branch: `feat/youtube-article-body`, stacked on `feat/podcast-article`.

## Source

The code is the legacy implementation from `unnoo/slax_reader_backend` (`feat/youtube-article-body`, commit `6986d806`) and `unnoo/slax_reader_frontend` (`feat/youtube-article-body`, commit `581e85c0`), merged file by file with `git merge-file`.

## Commands and results

| Command | Result |
| --- | --- |
| `pnpm api -- typecheck` | Passed. |
| `pnpm api -- test` with `RUN_PG_INTEGRATION_TESTS=1` on an isolated Postgres 17 | 2,240 passed, 41 skipped; only `collectionTelemetryLogs.integration.test.ts` failed, because it needs the separate logs database. |
| Migrations on an empty Postgres 17 and `prisma migrate diff --exit-code` at this branch | No difference. |
| `pnpm api -- build edge` and `build core` with the public template | Offline dry runs passed. |
| Web `vue-tsc` | Identical to `origin/dev`. |
| `pnpm web -- test` | All passed except the 2 `userLocaleFallback.spec.ts` failures that also exist on `origin/dev`. |
| `pnpm web -- build` | Passed. |
| ESLint on new Web files | 0 errors. |
| `openspec validate --all --strict` | Passed. The validator notes that this change's MODIFIED delta needs `youtube-ai-article` archived first. |

## Review

Local `REVIEW.md` review: no Important findings. The change has no migration and no new configuration.

The PR review then found one Important issue, now fixed. The marks check read only the owner's copy of the bookmark, but the body belongs to the shared bookmark row. `MarkRepo.hasLiveMarksOnBookmark` now counts live marks of every reader. A unit test and a Postgres integration test (`test/infra/markRepo.integration.test.ts`) cover it. The review also found that a body check during playback ended the reload checks for the visit. `YoutubeArticleBar` now continues the checks when playback stops, with a test.

The second PR review found no Important issues. Its Nits were fixed: takedown also restores flagged bookmarks and bodies with unreadable cues, checks the video id, and logs bodies it could not write; a failed self-heal write answers `body_ready` false; `body_ready` follows the viewer's version; `bodyHasMarks` answers with one query of the user bookmarks; the status lines are one shared component. Answered without a change: podcasts keep replacing the body despite marks (see `design.md`), and the YouTube body text keeps the caption-only form of the raw body, without a title.

## Not validated

No real model run and no browser check of the body swap, the side transcript, marks on the article body, or the mobile layout.
