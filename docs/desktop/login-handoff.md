# Desktop browser authorization deployment

The `desktop-login-handoff` change adds explicit browser consent and native PKCE exchange. Building the macOS app does not activate these routes on an existing deployment. Keep the API and Web switches disabled until the additive migration and matching application code are available.

## Configuration

| Owner | Non-secret configuration | Requirement |
| --- | --- | --- |
| API | `DESKTOP_AUTH_ENABLED` | Exact string `true` enables issuance and exchange; default `false` |
| API | `DESKTOP_AUTH_DEPLOYMENT_ID` | Stable, nonempty identifier of at most 128 characters, distinct for each deployment |
| API | `FRONT_END_URL` | Trusted canonical Web origin; issuance requires that exact browser Origin |
| API | `DESKTOP_AUTH_RATE_LIMITER` | Dedicated native Wrangler rate-limit binding; the public template uses namespace `1002`, 20 requests per 60 seconds |
| Web | `DESKTOP_AUTH_ENABLED` | Exact string `true`, included through the existing validated runtime configuration |
| Web | Existing API and OAuth settings | Point to the same API deployment and preserve the current Google/Apple provider configuration |
| Desktop | `dev[:environment]` / `build[:environment]` | Dev defaults to local; build defaults to main, independently of branch |
| Desktop | `SLAX_DESKTOP_API_ORIGIN`, `SLAX_DESKTOP_WEB_ORIGIN` | Optional paired public origin overrides; local requires loopback, remote requires HTTPS |

The API combines the trusted deployment identifier with the configured Web origin when storing and consuming a code. It never chooses an environment from a request-supplied Origin. Native exchange has no browser Origin and requires the verifier retained in restricted Rust-owned local credential files. The fixed callback scheme follows the trusted Web build profile: local/development uses `slaxreader-mac-local`, preview uses `slaxreader-mac-preview`, beta uses `slaxreader-mac-beta`, and main/production uses `slaxreader-mac`. Each callback is `<scheme>://auth?code=…&state=…`; arbitrary redirects are rejected. Native bearer credentials never enter this URL or Web consent state.

Existing database/signing credentials remain operator-managed. Do not paste them into instructions, generated configuration, logs or acceptance artifacts. A missing limiter, disabled switch or absent deployment identifier fails closed rather than falling back to normal Web login credentials.

## Additive rollout

1. Review the migration at `apps/api/prisma/pg_migrations/20261016053229_desktop_login_handoff/migration.sql`. It adds `sr_desktop_auth_code` with code/state hashes, an account relation, deployment binding, server-clock expiry, consumption timestamp and expiry/account indexes. It follows the existing Prisma relation mode without a physical foreign key; active-account predicates gate both issuance and redemption.
2. The operator selects the intended database and reviews the existing environment configuration. For a local development database use `pnpm api -- migration:local:pgsql`. For an explicitly authorized remote database use `pnpm api -- migration:deploy:pgsql`. These commands mutate the database selected by operator configuration; they are not offline validation commands.
3. Deploy the API with the new routes, marker propagation and limiter while keeping the switch disabled. Use the repository's selected configuration and environment, for example `pnpm api -- deploy --config <configuration-path> --env <environment>`. A plan-only invocation adds `--dry-run`; it generates local Worker configurations and does not deploy or apply a migration. Do not invoke setup as a deployment check.
4. Deploy the Web consent implementation with its switch disabled. Enable both switches only after the matching API/Web origin pair and deployment identifier have been verified in the dedicated development environment. Select the corresponding native profile explicitly, for example `pnpm desktop -- build:local --debug`. Desktop uses the normal login entry, with no additional native feature switch. Local loopback development is enabled automatically; remote Web/API deployment switches remain required.
5. Install the bundled app and follow the live handoff checklist in [acceptance.md](acceptance.md): signed-in and signed-out Google/Apple, explicit consent, cancellation, account switching, expiry, replay, duplicate callback delivery and explicit open-app retry. Browser navigation or provider completion alone must never issue a desktop code.

No remote migration or deployment was performed to prepare the desktop code. Local PostgreSQL concurrency evidence does not establish live provider or installed callback acceptance.

## Session recovery and rollback

Codes expire after 120 seconds. A same-deployment exchange attempt atomically deletes the code before validating/signing; both successful and failed attempts leave no corresponding row. Cross-deployment attempts cannot delete another environment's record. A signing or network failure after consumption requires another explicit authorization. Expired and legacy-consumed rows are removed in bounded maintenance on issuance/exchange without a retention delay; correctness relies on the conditional consume predicate, not cleanup timing.

The native pending attempt lasts ten minutes and is replaced or cancelled explicitly. Reauthorization with the current account preserves the account database and pending writes; a different account requires the existing sign-out/discard flow. Token refresh retains the signed `macos` marker and the normal Reader audience and expiry policy.

To roll back entry, disable the Web consent switch and API issuance/exchange switch first. Keep the additive table and existing desktop-compatible token refresh support while installed clients may still use them. Let outstanding codes expire. Do not run a destructive down migration, delete account data, change unrelated client sessions or remove provider configuration as part of rollback.
