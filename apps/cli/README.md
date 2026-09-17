# apps/cli

The Slax Reader command line interface: save links to a Slax Reader library from a terminal, or from an AI agent driving the CLI.

## What belongs here

- The CLI — command definitions, argument parsing, output formatting, and its Node entrypoint.
- CLI-local build configuration and assets.
- Unit tests, kept next to the code they test.

## What does not belong here

- Code shared with another app or package — it goes in `packages/`.
- Cross-app end-to-end and integration tests — they go in `tests/e2e/`.

## Migration source

[`slax-lab/slax-reader-cli`](https://github.com/slax-lab/slax-reader-cli) — a Node CLI published to npm as `@slax-lab/reader-cli`. It ships its own user documentation and agent skills under `docs/` and `skills/`; decide on migration whether those move with the code or land in the repository-level `docs/`.

## Interim owner

@boxcounter — interim owner until a dedicated code owner is assigned. See `.github/CODEOWNERS`.
