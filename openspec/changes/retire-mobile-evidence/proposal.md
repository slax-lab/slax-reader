# Proposal

## Why

The mobile evidence directory is a 190 MB historical record. Its coverage ledger, native-evidence verifier, evidence-only CI job, and external links across documentation, fixtures, and OpenSpec changes add maintenance cost, but the artifacts no longer establish current acceptance. The user has explicitly retired the evidence set and asked that it stop being treated as proof.

## What Changes

- Delete the former mobile evidence directory, the evidence coverage ledger, the native-evidence verifier, and the evidence-only CI job.
- Keep the existing source-manifest, source/asset, localization, fixture, and application checks in `pnpm mobile -- check`.
- Remove external references to the retired evidence directory from documentation, fixture material, tooling, tests, and active OpenSpec changes.
- Delete the capture harnesses, runtime plans, and report bindings that can only run against the retired artifacts instead of leaving placeholder paths; keep native control sources and every check that runs without the artifacts.
- Archive completed Mobile application OpenSpec changes after their references are removed, and record the user's manual acceptance of `expo-mobile-migration` together with the evidence retirement.
- Leave Git history unchanged; this change removes the artifacts from the current tree only.

## Capabilities

### New Capabilities

- `mobile-evidence-retirement`: repository retention, documentation, fixture, and CI behavior after native evidence artifacts are retired.

### Modified Capabilities

None. Runtime Mobile behavior, API contracts, and existing product capabilities are unchanged.

## Impact

- Mobile CI and tooling, `docs/mobile`, `apps/mobile/assets`, `apps/mobile/fixtures`, `apps/mobile/tests`, and active OpenSpec changes.
- Completed Mobile application OpenSpec changes are archived after their evidence references are removed.
- No UI, runtime application, public API, deployment, or store-release behavior changes. Git history rewriting is explicitly out of scope.
