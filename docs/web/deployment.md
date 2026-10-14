# Web Pages deployment

The `Web Pages deploy` GitHub Actions workflow publishes the existing Nuxt Pages output. It does not migrate the application to Workers or create Cloudflare resources.

## Release destinations

| Merged target branch | GitHub Environment | Web build profile | Existing destination |
| --- | --- | --- | --- |
| `dev` | `dev` | `preview` | Test-account Pages project |
| `beta` | `beta` | `beta` | Production-account beta Pages project |
| `main` | `main` | `production` | Production-account production Pages project |

The workflow runs only after an eligible pull request is merged. It checks out that merge commit, builds once for the selected environment, and publishes only that destination. Ordinary PR checks receive no release credentials. API-only, Extension-only, and documentation-only changes do not publish Web; shared frontend packages, build tooling, and dependency changes do.

A repository branch and a Pages project's production branch need not share a name. The helper reads the selected project's current `production_branch` and deploys to it. For example, repository `main` can update a project whose primary branch is still `master`. Do not rename projects or branches merely to enable this workflow.

## GitHub settings to fill

In the repository, open **Settings → Environments** and create or reuse `dev`, `beta`, and `main`. Restrict each Environment to its corresponding release branch; retain any required reviewer policy. Configure these same names separately in each Environment:

| Kind | Name | Value |
| --- | --- | --- |
| Variable | `CLOUDFLARE_ACCOUNT_ID` | The account that owns this environment's existing Pages project |
| Variable | `PAGES_PROJECT_NAME` | The existing Pages project name, not its custom domain |
| Variable | `WEB_BUILD_CONFIG` | A JSON object containing this environment's public Web build settings |
| Secret | `CLOUDFLARE_API_TOKEN` | A token with **Account → Cloudflare Pages → Edit** and **Zone → Cache Purge → Purge** permissions for the selected account and zone |
| Secret | `CF_ZONE_ID` | The existing zone containing this environment's Web hostname; reused from API deployment |

Use the test account for `dev`, and the production account for `beta` and `main`. An existing API deployment token is reusable when it has both Pages and Cache Purge permissions. No credential value belongs in a workflow file, pull request, issue, or chat.

The workflow reserves these input references; it does not create or populate GitHub settings. Missing or invalid inputs fail the release before publication. There is no default account, fallback project, or automatic project creation.

### Public build configuration

Use the following shape for `WEB_BUILD_CONFIG`, replacing every example value with the existing configuration for that environment:

```json
{
  "PUBLIC_BASE_URL": "https://reader.example.com",
  "AUTH_BASE_URL": "https://reader.example.com",
  "SHARE_BASE_URL": "https://reader.example.com",
  "DWEB_API_BASE_URL": "https://api.example.com",
  "COOKIE_DOMAIN": "example.com",
  "COOKIE_TOKEN_NAME": "reader_session",
  "GOOGLE_OAUTH_CLIENT_ID": "your-client-id.apps.googleusercontent.com"
}
```

All seven keys above are required. Values must be strings. Use the current API/session cookie name and domain, not a newly invented cookie configuration. OAuth origins and callback URLs must permit the deployed Web domain.

Optional keys, when already used by your environment:

- `APPLE_OAUTH_CLIENT_ID`
- `TURNSTILE_SITE_KEY`
- `PUSH_API_PUBLIC_KEY`
- `GTM_CONTAINER_ID`
- `STRIPE_ONCE_PRICE_ID`
- `STRIPE_SUB_PRICE_ID`
- `STRIPE_ONTIME_PRICE_ID`
- `STRIPE_PUBLIC_KEY`

Omit unused optional values. The allowlist follows `apps/web/env.schema.ts`; unknown keys and arbitrary process settings are rejected. Do not add `SLAX_ENV`: the release branch selects it. Do not add Cloudflare tokens, OAuth client secrets, private keys, database passwords, or backend runtime credentials. These build values are intentionally available to browsers even if stored in GitHub Secrets instead of Variables.

Values previously configured only in Pages' build dashboard are not automatically available to GitHub Actions. Supply their public equivalents through `WEB_BUILD_CONFIG`. Each environment builds its own bundle because some values also affect prerendered HTML and the browser Service Worker.

## Existing Pages prerequisites

Before the first release, verify the project's primary deployment already has:

- Its intended production branch and custom domains.
- `BACKEND` bound to the matching API service with the `ContentEntry` entrypoint.
- `OSS` bound to the matching R2 bucket.
- Existing runtime compatibility settings remain managed by Cloudflare. The release helper does not impose its own compatibility-date or flag requirements; Wrangler/Cloudflare validates them during deployment.
- Any additional bindings used by the deployment, including Nuxt Content D1 if required, and existing runtime variables/secrets.

The release performs a read-only project check and preserves the remote settings. It does not infer a missing binding, repair configuration, run migrations, or deploy the API. Confirm runtime settings in Cloudflare rather than downloading or pasting secret-bearing configuration into this repository.

Nuxt currently emits a generated `dist/wrangler.toml` containing an incomplete binding projection. The release helper excludes it from an isolated staging copy and runs Wrangler without a discoverable local configuration. This is deliberate: uploading that projection as configuration could replace existing bindings. The compiled `_worker.js` directory, server chunks, static assets, `_routes.json`, `_headers`, and `_redirects` remain in the publication input. Upload uses `--no-bundle` because Nuxt already compiled the server modules and WASM; a second bundling pass in the pinned Wrangler fails on dynamic WASM imports.

## First rollout and retries

1. Prepare the three GitHub Environments and confirm the existing Pages prerequisites. Before Actions takes over an environment, disable duplicate automatic production and preview builds from that Pages project's Git integration. Keep its domains and deployment history.
2. Merge the implementation PR to `dev` after required checks and review. If the Environment is not configured yet, the release fails before publication; fill the inputs and rerun that workflow afterward.
3. Verify the test project first: the primary deployment updates, URLs select the test API, login works, bookmarks synchronize, share/collection SSR works, and PDF delivery supports normal and Range requests. Check the extension bridge and PWA when relevant. The existing `preview` profile permits indexing; protect test sites appropriately.
4. Promote through `dev → beta → main` using the repository's normal human-controlled promotion PRs. An agent must not merge these promotion PRs.

Releases serialize per environment without cancelling an upload already in progress. Before upload, the workflow checks whether newer Web-related changes have reached that branch. A superseded run is skipped, including on retry; unrelated changes do not invalidate it. Retry the newer eligible run instead of forcing an old bundle over it. API and Web releases are independent, so this workflow does not guarantee API deployment ordering.

After Pages confirms the final deployment succeeded, the helper calls [Cloudflare's cache purge API](https://developers.cloudflare.com/api/resources/cache/methods/purge/) with a single hostname: `dev` uses `r.slax.dev`, `beta` uses `r-beta.slax.com`, and `main` uses `r.slax.com`. This clears all edge cache entries for that hostname, not the entire zone, other environments, browser caches, or Service Worker caches. Failed or superseded deployments do not purge.

A failed build, project check, upload, final deployment status, or cache purge fails the job. Purge requests have a 15-second timeout and require both HTTP success and JSON `success: true`; rerun an eligible release after a transient error. A purge failure does not roll back a successful Pages deployment. Diagnostics identify the failing stage without dumping raw responses or credentials. Temporary publication files and captured external logs are removed, not uploaded as CI artifacts.

On first rollout, check that the log reports Cloudflare accepted the purge, then request a previously cached asset and inspect its version and `CF-Cache-Status`. API acceptance alone does not prove a particular asset was evicted, and other traffic can refill the cache before verification.

For rollback, restore a known-good deployment through the existing Pages deployment history and pause or revert the faulty release workflow/change as appropriate. Do not delete or recreate the Pages project.

## Local and PR verification

Run the existing checks from the repository root with the synthetic public values described in [local development](development.md#checks-without-real-services):

```sh
pnpm install --frozen-lockfile
pnpm test:preflight
pnpm --filter @slax-reader/contracts typecheck
pnpm --filter @slax-reader/selection typecheck
pnpm web -- typecheck
pnpm web -- test
pnpm web -- build
pnpm exec openspec validate --all --strict
```

Focused release checks:

```sh
node --test tooling/web-pages-deploy.test.mjs tooling/web-pages-workflow.test.mjs
```

These use synthetic configuration, temporary build trees, mocked Cloudflare responses, and a fake deployment subprocess. After a successful build, also verify the actual staged output and render it through the installed workerd runtime:

```sh
SLAX_TEST_PAGES_BUILD=1 node --test tooling/web-pages-deploy.test.mjs tooling/web-pages-workflow.test.mjs
```

The pinned Wrangler 4.127.0 local `pages dev --no-bundle` path has been observed to fail while locating its generated middleware facade on macOS. This does not change the upload command; the explicit workerd smoke test checks the precompiled application independently of that dev wrapper. It is not a claim that the Wrangler local preview command passes.

These checks do not publish or change cloud settings. Passing them verifies the release contract and basic rendering, not real OAuth, service bindings, or deployment permissions. The first live deployment remains an operator check after configuration.

References: [Pages Direct Upload from CI](https://developers.cloudflare.com/pages/how-to/use-direct-upload-with-continuous-integration/) and [Pages configuration ownership](https://developers.cloudflare.com/pages/functions/wrangler-configuration/).
