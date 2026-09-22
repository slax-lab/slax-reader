# Design — frontend preflight check

`tooling/preflight.mjs` uses only Node.js built-ins so it can run before workspace dependencies are installed. The root `preflight` script delegates to it; the tool does not depend on Nuxt, WXT, Zod, or dotenv.

The check has three layers:

1. Runtime: compare the running Node.js version with the frontend engine minimum and compare the installed pnpm version with the root `packageManager` pin.
2. Workspace: check `node_modules/.modules.yaml`, each app's workspace dependency links, and the app-local `nuxt`/`wxt` executable.
3. Configuration: load only the names and values needed for validation from the same app-local file order as the current loaders. Process variables override file values, and the first file defining a variable wins. The report prints names and sources, never values.

Web checks the shared URLs, API URL, cookie settings, and public OAuth/Turnstile fields. Extension checks the shared URLs, Extension API URL, and cookie settings. Google OAuth is required; Apple OAuth and Turnstile are optional and produce informational output when absent or empty. Backend path configuration is informational and never blocks this frontend-only check.

Variable messages use `（必填）` for the three shared URLs, two cookie settings, each app's API URL, and Web's `GOOGLE_OAUTH_CLIENT_ID`. Web's `APPLE_OAUTH_CLIENT_ID` and `TURNSTILE_SITE_KEY` use `（可选）`; absence and empty values are informational and do not block local frontend checks. Optional schema fields are not added to the required checks. The backend note identifies `SLAX_BACKEND_DIR` as required only for `pnpm web -- dev`, without changing the check's exit status. These labels apply to missing, empty, malformed, and configured values in both colored and plain-text reports.

The command exits with status 1 when a blocking problem exists and status 0 when only warnings or informational messages remain. `--app` and `--env` narrow the check without changing application configuration.

The output is structured into titled sections and app subsections. Status icons and messages use ANSI colors when the output is interactive, can be forced with `--color`, and can be disabled with `--no-color` or the standard `NO_COLOR` environment variable. Redirected output stays free of escape sequences so CI logs remain readable.

When an app has no configured variables, the environment section gives its app-local `.env` and profile-local `.env.<SLAX_ENV>.local` paths and links the tracked `.env.example`. This keeps the setup guidance beside the application instead of suggesting a root environment file that the loaders do not read.
