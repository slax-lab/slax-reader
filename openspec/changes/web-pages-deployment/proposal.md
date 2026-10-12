# Proposal

## Why

The Web application already builds for Cloudflare Pages and the operator already has separate test, beta, and production projects, but the repository has no Web release workflow. Add the smallest merge-triggered release path while leaving the existing hosting, account separation, and runtime bindings intact.

## What Changes

- Add one Web Pages release workflow for merged pull requests targeting `dev`, `beta`, and `main`, checking out the merged revision and selecting GitHub Environments `dev`, `beta`, and `prod` respectively.
- Map these branches to existing Web build profiles `preview`, `beta`, and `production`. Keep local development unchanged.
- Reserve environment-scoped GitHub Variables for the account ID, Pages project name, and allowlisted public Web build configuration; reserve an environment-scoped Secret for the Pages deployment token. The operator fills these after the implementation PR is ready.
- Read the selected existing Pages project's production branch and required public binding metadata before publication. Deploy to that branch rather than assuming it matches the repository branch.
- Preserve dashboard-managed runtime configuration by uploading a sanitized copy of the existing Pages build without a discovered Wrangler configuration. Keep the server bundle, routing files, and public assets; do not upload the generated public-template deployment configuration.
- Fail before publication on missing inputs, an unavailable project, missing required service/R2 bindings, incompatible runtime settings, or invalid build output. Serialize releases per environment and skip superseded Web revisions.
- Add focused offline regressions and operator documentation explaining inputs, existing-project setup, retries, and the first test-environment verification.

## Capabilities

### New Capabilities

- `web-pages-release`: Merge-gated Web releases to existing Pages projects, environment-scoped inputs, public build configuration, preservation of runtime settings, and safe publication.

### Modified Capabilities

None. Existing release-branching and frontend local-environment behavior stays unchanged. This Web-specific input contract uses Variables for non-secret values and Secrets for credentials; it does not change the API workflow's private-configuration policy.

## Impact

- Add `.github/workflows/web-deploy.yml`, a narrowly scoped release helper under `tooling/` with tests, and a Web deployment guide under `docs/web/`.
- Extend existing frontend CI/test registration to exercise the release contract without credentials.
- Reuse `pnpm web -- build`, Nuxt's Pages preset, and the already pinned Web Wrangler dependency. No new dependency or general deployment framework is required.
- No Workers migration, resource creation, domain changes, API release edits, database migrations, binding replacement, runtime-secret upload, automatic GitHub settings changes, or live deployment during implementation.
- The implementation branch and PR target `dev`; real account IDs, project names, credentials, and live deployment responses stay out of tracked files and public build artifacts.
