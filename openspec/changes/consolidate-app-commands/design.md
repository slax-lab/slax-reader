# Design

## Context

The root workspace currently owns the entry point for installation and repository checks, while Web and Extension each have their own package scripts. The dispatcher must work before app dependencies are available far enough to print usage, and it must not duplicate a growing list of app scripts in the root manifest.

## Goals / Non-Goals

**Goals:**

- Give both frontend apps the same `pnpm <app> -- <command>` interface planned for the future API app.
- Discover user-facing commands from each app's `package.json`, excluding lifecycle hooks that are run automatically by pnpm.
- Preserve command arguments and child exit status.
- Keep aliases limited to compatibility names that improve onboarding (`typecheck` for Extension and `package` for Extension zip).

**Non-Goals:**

- Implement the future `pnpm api -- <command>` dispatcher.
- Change application scripts, runtime behavior, or package dependencies.
- Start a backend or add a root-level environment loader.

## Decisions

The root scripts delegate to small Node.js wrappers in `tooling/`. The wrappers resolve the workspace root from their own file location, read the selected app manifest, and invoke `pnpm --filter <package> run <script> -- ...args`. Reading the manifest at runtime keeps the app manifest authoritative and means new app scripts do not require a root `package.json` edit. A static allowlist was considered, but it would drift whenever an app script changed.

The wrappers accept the conventional `--` separator and also tolerate direct arguments for simple invocations. They print a concise usage list for help and reject unknown commands before spawning pnpm. Extension aliases map `typecheck` to its existing `compile` script and `package` to `zip`; Web uses its package script names directly.

## Risks / Trade-offs

- [Risk] A malformed app manifest prevents the dispatcher from listing or running commands → report the parse/read error and exit non-zero before spawning a child.
- [Risk] Contributors may rely on removed root aliases → document the new forms in the root and app guides; the old aliases are intentionally removed to keep the root surface small.
- [Risk] pnpm version differences could alter argument parsing → always use the explicit `run` subcommand and separator when forwarding arguments.

## Migration Plan

1. Add the two root scripts and wrappers.
2. Update contributor and app documentation to use the dispatcher convention.
3. Validate wrapper parsing, help, unknown-command handling, and JavaScript syntax.
4. If rollback is needed, restore the removed root aliases and remove the two wrappers; app package scripts are unaffected.
