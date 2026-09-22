# Add a frontend preflight check command

## Why

Contributors currently discover missing dependency installation and environment variables only after a Web or Extension command fails. That is especially confusing while the backend remains outside this repository. A small root command can give a safe, app-focused setup report before a contributor starts a build or development server.

## What Changes

- Add the `preflight` root script, invoked as `pnpm preflight`, backed by `tooling/preflight.mjs`.
- Check the supported Node.js and pinned pnpm versions, the pnpm workspace installation marker, and the workspace links needed by Web and Extension.
- Check required Web and Extension variables for the selected `SLAX_ENV`, following the existing app-local dotenv file order and process-environment precedence.
- Report missing or malformed variables by name without printing values. Treat `SLAX_BACKEND_DIR` as an informational backend-integration note because backend setup is deferred.
- Present sections and check states with readable terminal styling while remaining plain-text safe for CI and redirected output.
- Document the command and the app-local environment-file boundary for contributors.

## Non-goals

- Do not start, install, inspect, or modify the external backend.
- Do not validate secrets, make network requests, or change the applications' existing environment loaders.
- Do not make optional analytics, OAuth, or Turnstile placeholder values block local frontend builds.
