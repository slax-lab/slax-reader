# Proposal

## Why

The CLI currently publishes only manually pushed stable tags reachable from `main`, so it cannot provide downloadable builds after integration or beta promotion. The reported run failed before installation or packaging because `cli-v1.0.1` pointed to a `dev` commit outside `main` history; automatic channel-specific releases will align distribution with the repository promotion flow.

## What Changes

- Raise the CLI base version from `1.0.1` to `1.0.2` in the first implementation PR, as explicitly requested for immediate post-merge validation. Future versions remain dynamic.

- Replace tag-push initiation with post-merge pushes to `dev`, `beta`, and `main` in the existing `cli-release.yml` workflow.
- Release only when the push changes `apps/cli/**` and increases the stable version in `apps/cli/package.json` relative to the destination branch before the push. Read the actual version dynamically; `1.0.1` is only an example, never a fixed target.
- Derive `cli-v<version>-dev`, `cli-v<version>-beta`, or `cli-v<version>` from the destination branch. Keep the committed manifest at the stable base version, and derive prerelease package versions only in the temporary release build.
- Build and smoke-test the exact installable archive before creating an immutable tag at the merged revision and uploading the archive and checksum to that tag's GitHub Release.
- Mark dev/beta Releases as prereleases and distribute their packages through GitHub only. Preserve existing npm Trusted Publishing, provenance, exact-byte verification, and stable GitHub Release distribution for `main`.
- Complete automatic tag creation and distribution within the same workflow run; do not depend on another tag-push run triggered by `GITHUB_TOKEN`.
- Preserve conflict detection and resumable publication. Never replace existing tags, package versions, or conflicting release assets automatically.

## Capabilities

### New Capabilities

- `cli-release`: branch-driven CLI release eligibility, channel/version derivation, validated archive distribution, stable npm publishing, and failure recovery.

### Modified Capabilities

None of the current living capabilities changes. `release-branching` continues to govern human-reviewed branch promotion. The completed but unarchived `migrate-reader-cli` change contains the historical tag-only publication contract; this proposal explicitly supersedes its publication clauses, and its future archive must retain the new `cli-release` contract instead of reintroducing that policy.

## Impact

- `.github/workflows/cli-release.yml`, `tooling/cli-release.mjs`, and their existing tests.
- `apps/cli/script/verify-package.mjs`, release-version handling around `apps/cli/tsup.config.ts`, and any narrowly necessary fixture changes so the executable version and packed manifest agree for prereleases.
- `docs/cli/RELEASE.md`, associated development instructions, README, and the release overview rule in `.rulesync/` with its regenerated agent documents; no change to the public npm identity, executable name, application commands, or branch promotion rules.
- GitHub tags/Releases and the existing npm trusted publisher. Keeping `cli-release.yml` preserves the configured workflow identity; automated tag creation must be allowed by applicable repository rulesets.
- Existing `cli-v1.0.1` is an observed historical collision, not the new target version. No existing remote Release or tag will be changed during planning or automatically rewritten during implementation.
