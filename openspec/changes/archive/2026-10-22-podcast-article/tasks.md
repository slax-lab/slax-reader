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
- [x] 3.5 Resolve the PR review Nits and add the contract step of `youtube-ai-article` (see `validation.md`).
- [x] 3.6 Merged into `feat/youtube-ai-article` (PR #220), so this migration ships with `youtube-ai-article`. Promote `dev` → `beta` → `main` in one pass; the P0 caption write fails softly in the window (see `design.md`).
- [ ] 3.3 Before this PR merges (a merge to `dev` deploys and runs migrations): add `ASSEMBLYAI_API_KEY` to `[vars]` and the `PODCAST_WORKFLOW` binding to the private configuration TOML; locally, add the key to `deploy/local/.dev.vars`.
- [ ] 3.4 After deploy: enable `podcast` for internal accounts and test the three episode kinds listed in the design.
- [x] 3.7 Add the `20261022140000_seed_podcast_lab_users` migration: accounts that already saved a podcast link get `podcast` on (an explicit off row is preserved), so internal testers do not depend on a manual Settings click.
- [x] 3.8 Fetch the Xiaoyuzhou episode page through Zyte's browser mode (`browserHtml: true`) unconditionally (Xiaoyuzhou rejects the Worker's direct fetch with 403), parse the audio URL from that HTML, and hand it to AssemblyAI. Unit tests cover the browser-mode call and a terminal Zyte error.
