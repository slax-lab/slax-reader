# Proposal

## Why

After the beta to main promotion (#230), the production Web release failed with `Missing or invalid CLOUDFLARE_ACCOUNT_ID`. The workflow selected a GitHub Environment named after the target branch, so `main` read the `main` Environment, which holds no Variables or Secrets. The Web Variables and Secrets for production live in the `prod` Environment, the same Environment the API deploy workflow already uses for `main`.

## What Changes

- Select GitHub Environment `prod` when a Web pull request is merged into `main`; `dev` and `beta` keep selecting their branch-named Environments.
- Update the workflow regression test and the operator documentation to name `prod`.

## Capabilities

### New Capabilities

- `web-release-environment`: Mapping of Web release target branches to GitHub Environments.

### Modified Capabilities

None. This supersedes the `main` Environment mapping introduced by the unarchived `web-deploy-cache-purge` change, and restores the `prod` mapping of `web-pages-deployment`, without editing either change's files.

## Impact

Changes `.github/workflows/web-deploy.yml`, `tooling/web-pages-workflow.test.mjs` and `docs/web/deployment.md`. The build profile, `TARGET_BRANCH`, the concurrency group and the hostname purge mapping are unchanged. No new dependencies or cloud provisioning. The first merge into `main` after this lands is the first real exercise of the `prod` mapping for Web.
