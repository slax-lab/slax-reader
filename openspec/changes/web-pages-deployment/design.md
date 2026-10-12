# Design

## Context

See proposal.md for motivation. `apps/web/nuxt.config.ts` uses the Pages preset and produces `dist/_worker.js`, routing metadata, and static assets. Its build hook also writes `dist/wrangler.toml` from `config/backend-binding.ts`; that projection includes only `BACKEND` and `OSS` and can fall back to a public template. It is not a complete representation of the existing Pages projects.

`tooling/web.mjs` already dispatches `pnpm web -- build`. `apps/web/env.schema.ts` defines the browser-visible configuration, and `tooling/env-files.mjs` accepts process overrides. `.github/workflows/frontend-ci.yml` performs PR checks; `.github/workflows/api-deploy.yml` demonstrates merged-PR eligibility, merge-SHA checkout, scoped freshness checks, and environment selection. Existing root Node tests provide a place for release regressions without adding dependencies.

The operator has one existing test project in a test account and separate beta and production projects in another account. Actual IDs and project names are deployment inputs, not source constants. The Pages production branches and complete live runtime configuration have not been inspected.

A design artifact is needed because publishing crosses account and credential boundaries and an incomplete Wrangler projection could replace working runtime bindings.

## Goals / Non-Goals

**Goals:** Keep the change centered on one workflow and a small, testable release helper. Reuse the existing Nuxt build and pinned Wrangler. Let the operator fill GitHub settings after the implementation PR is prepared. Separate application publication from infrastructure configuration.

**Non-Goals:** Workers migration; changing local setup, rendering, indexing profiles, or authentication behavior; private configuration repository integration; generic deployment tooling; managing GitHub Environments or Cloudflare settings via API writes; uploading server credentials; synchronizing or deploying API releases.

## Decisions

### 1. Fixed branch mapping, configurable existing destinations

Use `pull_request_target: closed` for `dev`, `beta`, and `main`, guarded by merged status and this repository as the base repository. Checkout only `merge_commit_sha` with persisted credentials disabled. Read the job environment from the base branch: `dev`, `beta`, or `prod`; choose `preview`, `beta`, or `production` for `SLAX_ENV`.

Use scoped Variables `CLOUDFLARE_ACCOUNT_ID`, `PAGES_PROJECT_NAME`, and `WEB_BUILD_CONFIG`, plus Secret `CLOUDFLARE_API_TOKEN`. No hard-coded IDs, implicit account discovery, matrix publishing to all environments, manual branch selector, or production-branch Variable. Query the chosen project's production branch immediately before publication and explicitly supply it to Wrangler. This supports a legacy `master` Pages branch while building repository `main`.

The path scope includes `apps/web/**`, `packages/contracts/**`, `packages/frontend-types/**`, `packages/frontend-utils/**`, `packages/selection/**`, the Web dispatcher, environment/pnpm helpers, the new release helper, the public API template used by the build, root dependency manifests, and the relevant frontend/release workflows. Use the same scope for the freshness comparison and test that they agree.

### 2. One allowlisted public build configuration

`WEB_BUILD_CONFIG` is JSON with string values. Required keys follow `dwebEnvSchema`: `PUBLIC_BASE_URL`, `AUTH_BASE_URL`, `COOKIE_DOMAIN`, `COOKIE_TOKEN_NAME`, `SHARE_BASE_URL`, `DWEB_API_BASE_URL`, and `GOOGLE_OAUTH_CLIENT_ID`. Optional keys are `APPLE_OAUTH_CLIENT_ID`, `TURNSTILE_SITE_KEY`, `PUSH_API_PUBLIC_KEY`, `GTM_CONTAINER_ID`, and the four `STRIPE_*` keys already declared in that schema.

Reject unknown keys, invalid types, and invalid required values before building; normalize optional empty strings according to the existing optional-provider behavior. Do not allow JSON to set `SLAX_ENV`, `NODE_OPTIONS`, API config selectors, credentials, or arbitrary process settings. Set `SLAX_ENV` from the branch mapping, then pass only validated public values to the existing build subprocess. Avoid shell evaluation or interpolation of JSON values. Never source arbitrary environment text as shell code.

Installation and build steps receive no Cloudflare token. The release helper uses existing Web tooling/dependencies for validation rather than adding a new library. The build can use the established offline public binding projection because it is not published; no live backend credential file or database setup is needed to compile the Web application. Fail a build that tries to depend on live data rather than injecting server credentials into it.

Alternative: a long list of separate Variables would also work but expands workflow wiring without adding isolation. A secret containing all build configuration would obscure that these values are deliberately browser-visible.

### 3. Preserve runtime settings through config-free Pages upload

Do not change `backend-binding.ts` or make generated build configuration authoritative for remote Pages settings in this change. Before upload, query only the specified project's metadata with the deployment token; hold the response in memory and never log or persist raw environment values. Confirm the project name/account path, production branch, `BACKEND` service binding, `OSS` R2 binding, and a compatible `nodejs_compat` configuration. Where entrypoint metadata is exposed, require the expected `ContentEntry`; absent or ambiguous prerequisite data must produce an actionable stop rather than a replacement configuration.

Copy the build into an isolated temporary staging directory outside the checkout/config discovery ancestry. Exclude deployment configuration and redirect metadata (`wrangler.*`, `.wrangler`, generated config files), dotenv/credential files, and non-runtime release metadata. Reject unsafe symlinks and confirm `_worker.js/index.js`, routing metadata, and static output are present. Retain server chunks, WASM, `_headers`, `_redirects`, and `_routes.json` as produced by Nuxt. Inspect the final staged output, not only the original build directory.

Invoke the installed Web Wrangler by its absolute local CLI path, with the isolated staging directory as working directory and explicit `pages deploy --no-bundle`, output directory, project, production branch, and merged commit hash. Nuxt already compiles this multi-module Worker; rebundling the installed Nitro output fails on its dynamic WASM imports. Preserve the precompiled modules instead. Disable implicit dotenv/process binding loading and metrics. Do not invoke `pnpm exec` in a way that changes the child working directory back to the repository. Ensure no config redirect can recover the repository's generated configuration.

The installed Wrangler implementation reads the selected project's remote production configuration when no local Pages config is found. It only attaches a Wrangler configuration hash/build-output configuration when a local config exists. This is also documented as the supported dashboard-managed configuration mode. Test these publication boundaries explicitly. Extra bindings, including D1 and runtime secrets, remain managed by the existing project; do not reconstruct a partial config or run `pages download config`.

Alternative: supplying a newly generated full Pages TOML would require recovering every live binding and adopting configuration ownership, expanding this task and risking configuration loss. Config-free direct upload is the smaller intended operating mode, not a temporary fallback.

### 4. Keep workflow orchestration small and credential-safe

Add `tooling/web-pages-deploy.mjs` for input validation, project inspection, artifact staging, and invocation construction, with exported pure helpers and a narrow CLI. Keep event eligibility, setup, environment/concurrency selection, and freshness checks in `.github/workflows/web-deploy.yml`. Do not create a generalized release framework or a second configuration system.

Serialize per GitHub Environment with `cancel-in-progress: false`. Compare the merged revision with the current target branch using the release path scope before any upload; stop stale releases while allowing unrelated changes. Put deployment credentials only on the inspection/upload step. Use bounded HTTP timeouts and no credential-bearing redirects. Capture sensitive external output in restricted temporary logs, emit safe stage/status diagnostics, and clean it on every exit. If Wrangler does not guarantee final deployment status through its exit code, perform a bounded status check rather than treating upload acceptance as success.

### 5. Preserve validation and rollout boundaries

Use the existing PR CI for checks and wire release-helper tests into it. Fixture tests exercise actual helper subprocess and staging behavior with fake Wrangler/HTTP responses, not only source regexes. Test malformed JSON, missing inputs, three branch mappings, the legacy Pages branch, account/project lookup failure, preserved extra bindings, generated-config exclusion, no credential inheritance into builds, stale-release behavior, and upload failure.

Run the project's standard Web typecheck, tests, and build with documented placeholder public values, plus the root tooling regressions and strict OpenSpec validation. A successful local build and stubbed release prove the CI contract, not real deployment. Explicitly leave the first cloud deployment and browser checks for the operator after configuration; do not require production credentials merely to finish the implementation PR.

## Risks / Trade-offs

- [Existing remote bindings or compatibility settings are incomplete] -> Fail read-only preflight and identify the missing binding/setting; do not auto-create or overwrite it.
- [Config discovery uploads template bindings] -> Run config-free from isolated staging and test with conflicting configs in the original checkout.
- [Pages metadata contains sensitive environment values] -> Inspect required fields in memory, omit raw responses from diagnostics and artifacts, and clean temporary logs.
- [API and Web jobs run independently] -> Preserve current API contracts and require API prerequisites to exist; do not imply ordered API/Web publication.
- [Wrong account/project Variables] -> Verify project existence and branch, restrict each Environment's credentials, and have the operator confirm mapping during the first test deployment. No invented IDs can validate operator intent.
- [Existing Pages Git integration publishes twice] -> Document disabling its automatic production/preview builds when Actions takes over; retain project history and domains.
- [The existing preview profile permits indexing] -> Document test-site access protection as an operator concern; do not silently alter application SEO in this CI change.
- [The release runs trusted merged source with credentials] -> Require merge-only eligibility and branch/environment protections; no unmerged PR checkout or release token during dependency installation/build.

## Migration Plan

1. Review this change, implement the workflow/helper/tests/docs on `ci/web-pages-deployment`, run validation and local three-pass review, and open one implementation PR to `dev`.
2. Give the operator the exact Variables/Secret contract with placeholder JSON. The operator configures Environments and confirms existing Pages prerequisites; the agent does not set credentials or change cloud resources.
3. On merge, an unconfigured Environment fails before publication. After configuration, rerun the original workflow subject to the same source-freshness check; a superseded revision is not force-published.
4. Verify the test project first (correct API destination, login, bookmarks/sync, share/collection SSR, PDF delivery), then promote through beta and main with normal human-controlled promotion PRs.
5. On a faulty rollout, use the existing Pages deployment history to restore the previous deployment and pause this workflow or revert the change. Never delete/recreate a project to roll back.
