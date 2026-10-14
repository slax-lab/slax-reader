# Tasks

## 1. Port the API

- [x] 1.1 Merge the legacy P1 backend diff into `apps/api` with a per-file 3-way merge; keep the monorepo side where both changed (Labs list, Redis keys, cron generator, bookmark deletion); verify no conflict markers remain.
- [x] 1.2 Replace the legacy `visitorCanRead` copy with `BookmarkService.getBookmarkReadAccess` in `YoutubeArticleService`; verify the permission-matrix tests pass against the real `resolveBookmarkReadAccess`.
- [x] 1.3 Add the migration `20261014000000_youtube_article_target_language` and the schema fields; regenerate Prisma clients, cron, router and DI; verify `pnpm api -- typecheck`.
- [x] 1.4 Add `YOUTUBE_ARTICLE_WORKFLOW` to `deploy/cloudflare/api.toml.example` and the Worker environment type.
- [x] 1.5 Update tests that pin the Labs list, the router controller list and the `*/5` cron jobs; verify `pnpm api -- test` passes.

## 2. Port the Web client

- [x] 2.1 Merge the legacy P2 frontend diff into `apps/web` and `packages/contracts`; map `@commons/types/*` imports to `@slax-reader/contracts/*`; keep the PDF footer and page class from the monorepo.
- [x] 2.2 Hide `youtube_article` in Settings together with `youtube`; verify the visibility unit test.
- [x] 2.3 Verify the new component tests, the Web test suite and typecheck; failures and type errors that also exist on `dev` stay out of scope.

## 3. Review and delivery

- [x] 3.1 Run the local pre-push review from `REVIEW.md` and resolve Important findings.
- [x] 3.2 Open the PR to `dev` with `OpenSpec: youtube-ai-article`.
- [ ] 3.3 Before rollout: add the binding to the private Wrangler configuration, run the migration, enable `youtube_article` for internal accounts, and check about 10 real videos for faithfulness and cost.
