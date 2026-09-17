# tests/e2e

Cross-app end-to-end and integration tests for the Slax Reader monorepo.

## What belongs here

- End-to-end tests that exercise a real flow across more than one app — for example saving a link through the extension and reading it back through the web app, or a CLI command that round-trips through the backend.
- Integration tests that wire two or more apps or packages together against real (or realistically faked) dependencies.
- The fixtures, seed data, and harness code those tests need.

## What does not belong here

- **Unit tests.** They live next to the code they test, inside the app or package that owns that code (`apps/<app>/...`, `packages/<pkg>/...`). If a test only needs one module, it is not an end-to-end test and does not belong here.
- App-specific test configuration — that stays with the app.

## Migration source

New — no existing repository migrates into this directory. Each application brings its own unit tests with it; only the cross-app tests get written here.

## Interim owner

@boxcounter — interim owner until a dedicated code owner is assigned. See `.github/CODEOWNERS`.
