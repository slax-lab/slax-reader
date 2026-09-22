# Design — frontend preflight check

`tooling/preflight.mjs` uses only Node.js built-ins so it can run before workspace dependencies are installed. The root `preflight` script delegates to it; the tool does not depend on Nuxt, WXT, Zod, or dotenv.

The check has three layers:

1. Runtime: compare the running Node.js version with the frontend engine minimum and compare the installed pnpm version with the root `packageManager` pin.
2. Workspace: check `node_modules/.modules.yaml`, each app's workspace dependency links, and the app-local `nuxt`/`wxt` executable.
3. Configuration: load only the names and values needed for validation from the same app-local file order as the current loaders. Process variables override file values, and the first file defining a variable wins. The report prints names and sources, never values.

Web checks the shared URLs, API URL, cookie settings, and public OAuth/Turnstile fields. Extension checks the shared URLs, Extension API URL, and cookie settings. Empty OAuth and Turnstile values are warnings because the existing development documentation allows them as build placeholders. Backend path configuration is informational and never blocks this frontend-only check.

The command exits with status 1 when a blocking problem exists and status 0 when only warnings or informational messages remain. `--app` and `--env` narrow the check without changing application configuration.
