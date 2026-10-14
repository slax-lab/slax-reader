# Tasks

## 1. Port

- [x] 1.1 Merge the legacy API diff into `apps/api` with a per-file 3-way merge; keep the monorepo access rule in `PodcastService`; regenerate DI; verify typecheck and the API suite with Postgres integration tests.
- [x] 1.2 Merge the legacy Web diff into `apps/web` and `packages/contracts`; map legacy imports; verify the new tests, the Web suite and typecheck against `dev`.

## 2. Review and delivery

- [x] 2.1 Run the local pre-push review from `REVIEW.md` and resolve Important findings.
- [ ] 2.2 Open the PR with `OpenSpec: youtube-article-body`, stacked on `podcast-article`.
- [ ] 2.3 On beta with an internal account: check the body swap, the side transcript, marks on the article body and the mobile layout.
- [ ] 2.4 Archive after `youtube-ai-article` is archived; this change modifies its spec.
