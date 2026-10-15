# Design

## Context

`web-pages-deployment` mapped `main` to the `prod` Environment. `web-deploy-cache-purge` later changed it to `main`, on the premise that `prod` did not exist. The repository now has a `prod` Environment holding the Web Variables (`CLOUDFLARE_ACCOUNT_ID`, `PAGES_PROJECT_NAME`, `WEB_BUILD_CONFIG`) and the release Secrets, and an empty `main` Environment. `api-deploy.yml` already maps `main` to `prod`. See proposal.md for the failure that exposed this.

## Decisions

- Use the same expression as `api-deploy.yml` for the job `environment`: `base.ref == 'main' && 'prod' || base.ref`. Both release workflows then read from one production Environment.
- Leave `TARGET_BRANCH` and the concurrency group on the branch name. `tooling/web-pages-deploy.mjs` derives the build profile and purge hostname from `TARGET_BRANCH`, and serialization is per branch.
- Do not populate the `main` Environment; it is left unused.

## Risks / Trade-offs

- The workflow only runs for merged pull requests, so the mapping cannot be exercised before merge; the next merge into `main` verifies it. A failed run can be retried after fixing the Environment contents.
- Web and API releases now share the `prod` Environment, so any protection rule added to it applies to both.
