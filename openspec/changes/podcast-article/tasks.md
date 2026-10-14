# Tasks

## 1. Port the API

- [x] 1.1 Merge the legacy podcast backend diff into `apps/api` with a per-file 3-way merge; keep the monorepo PDF route, Labs list and bookmark repository methods; verify no conflict markers remain.
- [x] 1.2 Use `BookmarkService.getBookmarkReadAccess` in `PodcastService`; verify the podcast service tests pass against the real `resolveBookmarkReadAccess`.
- [x] 1.3 Replace the table renames with Prisma name mapping and an additive migration; verify all migrations apply on Postgres 17 and `prisma migrate diff` reports no difference.
- [x] 1.4 Point raw SQL at the database names and alias `video_id` to `source_id`; verify the Postgres integration tests for the YouTube and podcast repositories.
- [x] 1.5 Add `PODCAST_WORKFLOW` to `deploy/cloudflare/api.toml.example`, regenerate cron, router and DI, and update tests that pin the Labs list, cron jobs and controller list; verify `pnpm api -- test`.

## 2. Port the Web client

- [x] 2.1 Merge the legacy podcast frontend diff into `apps/web` and `packages/contracts`; map legacy imports; keep the monorepo PDF reader, page class and body key.
- [x] 2.2 Verify the new component tests, the Web test suite and typecheck; failures and type errors that also exist on `dev` stay out of scope.

## 3. Review and delivery

- [x] 3.1 Run the local pre-push review from `REVIEW.md` and resolve Important findings.
- [x] 3.2 Open the PR with `OpenSpec: podcast-article`, stacked on `youtube-ai-article`.
- [ ] 3.3 Before rollout: set `ASSEMBLYAI_API_KEY`, add the binding to the private Wrangler configuration, run the migration, enable `podcast` for internal accounts, and test the three episode kinds listed in the design.
