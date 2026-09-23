# Design

## Context

The migration PR is merged. Its follow-ups run on a separate worktree based on dev. See proposal.md for the approved scope. Current CI has valid public placeholder configuration; Web configuration is inferred during Nuxt prepare, and absent required fields can lead to unknown runtimeConfig types.

## Goals / Non-Goals

Keep real type checking in CI without production credentials. Preserve application behavior and existing unit-test timeout limits. Do not redesign environment loading or silently substitute production/login configuration for missing local values.

## Decisions

- Replace prepare-only CI commands with Web typecheck and Extension compile (including their lifecycle prepare/build steps). Validate absent, empty, and CI-placeholder cases in this clean worktree with no copied environment files. Retain CI placeholders rather than weakening type checking.
- Re-export the existing Axios classes, helper, and types from the advertised subpath. Verify import resolution and a request through a fake transport, without a live API.
- Use persistent signal listeners, retaining cleanup on child error/close. Exercise two successive signals against a child that waits for the second, plus cancelled SSR startup.
- Block protobufjs/sharp lifecycle scripts as dev previously did. protobufjs's hook only checks version conventions; Sharp's published platform binaries support standard installations without source compilation. Validate from a fresh virtual store, not an already-built node_modules.
- This task uses only frontend-review-followups. The three already-merged migration changes remain separate archive work; no historical PR metadata is rewritten.

## Risks / Trade-offs

- A platform needing a custom Sharp source build will need an explicit policy decision. Standard macOS/Linux prebuilt binaries are the intended path.
- Successful local type checks do not replace the GitHub CI run on the pull request targeting dev.
- Empty required Web environment values may fail type checking; report the exact result rather than masking it with casts or defaults.
