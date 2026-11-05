# Validation — 2026-10-31

## What was checked

- The annotation check sits inside the podcast branch of the crawl workflow. That branch runs only for links that `classifyPodcastUrl` recognizes and only with podcast Labs enabled. The new condition no longer looks at the source kind, so every recognized source takes the same path.
- `vitest run test/flow/addUrl/10-crawlWorkflowRun.test.ts`: the Xiaoyuzhou annotated-recapture test failed on `dev` (`6deae73c`), because the workflow fetched and replaced the body. With the change, Pocket Casts and Xiaoyuzhou both keep the body, fetch nothing, and release the bookmark as success. Unannotated recapture still captures. Labs off never checks annotations.
- The tests cover two sources. Apple Podcasts, Spotify, and RSS links take the same branch without any source-specific code.
- `15-podcastSave.test.ts` (`keepsAnnotatedBody`) passes unchanged.
- API `pnpm typecheck` passed. API `pnpm lint`: zero errors. API `pnpm test`: 198 files passed, 14 skipped; 2702 tests passed, 113 skipped.
- `openspec validate --all --strict`: 90 passed, 0 failed.

## Not verified (declared gap)

The workflow was not run in a deployed environment. A real run needs a database, R2, a browser fetch, and a user with highlights. The agent cannot set these up locally without secret configuration. Task 2.2 covers a real recapture on `dev` after deployment.

## Local review

- Bugs: a first capture has no body, so `keepsAnnotatedBody` returns false and capture proceeds. The kept path reuses the existing Pocket Casts short circuit unchanged.
- Security: no new input or network path. The change removes a page fetch in the kept case.
- Compliance: change-id `keep-annotated-podcast-bodies`. No user interface change, so no hands-on acceptance is required.
