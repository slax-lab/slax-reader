# Proposal

## Why

The extension has PR validation but no workflow that packages a merged version and attaches it to a GitHub Release. The CLI already provides branch-based distribution, and the extension needs the same version-gated delivery model for dev, beta and production.

## What Changes

- Add post-merge extension release automation for `dev`, `beta` and `main`, deriving eligibility from the complete push comparison and verifying the merged PR/source identity.
- Build only when `apps/extension/**` changes and `apps/extension/package.json` increases its stable base version relative to the destination branch before the merge. The human explicitly selected this CLI-compatible rule; unchanged versions and unrelated merges skip successfully.
- Derive `ext-v<version>-dev`, `ext-v<version>-beta` and `ext-v<version>` dynamically. Dev and beta are GitHub prereleases; main is a stable GitHub Release.
- Produce an installable Chromium extension ZIP and `SHA256SUMS`, validate the exact package, and publish them to the corresponding immutable source tag using the workflow token.
- Keep the committed package and Chrome manifest version numeric. Put channel suffixes in release tags, filenames and `version_name`, preserving the existing environment-specific extension IDs.
- Build with public GitHub Environment configuration, mapping dev to the existing preview profile, beta to beta, and main to production. Require valid environment values before packaging.
- Bump the extension source version from `1.16.2` to `1.16.3` at the human's explicit request, making this PR eligible for its first post-merge dev release. Validate all three channel packages before pushing the update.
- Preserve retry safety: matching releases/assets are reusable; conflicting tags or bytes fail without replacement. Keep extension releases from taking over the monorepo's global GitHub Latest pointer.

## Capabilities

### New Capabilities

- `extension-release`: merged/version-gated extension packaging, channel identity, public build configuration, validated GitHub assets and resumable distribution.

### Modified Capabilities

None. Existing branch promotion, CLI publication and extension runtime behavior remain owned by their current capabilities.

## Impact

- New `.github/workflows/extension-release.yml` and focused `tooling/extension-release*.mjs` helpers/tests, with release-tooling coverage in the existing CI entry points.
- New `docs/extension/RELEASE.md` and links from existing extension documentation; no generated agent-rule changes.
- Existing `pnpm extension -- zip`, WXT configuration and profile keys are reused. A temporary release-only configuration supplies `version_name` without changing ordinary local builds.
- Reuse each destination Environment's existing public `WEB_BUILD_CONFIG`, mapping `DWEB_API_BASE_URL` to `EXTENSIONS_API_BASE_URL` and forwarding only extension fields. An optional complete `EXTENSION_BUILD_CONFIG` takes precedence when extension-specific settings are needed. No new publication credential is needed.

## Non-goals

No Chrome Web Store or npm publication, CRX signing, automatic version increment, automatic PR merge, historical release backfill, or rewriting published tags/assets. The explicit `1.16.3` version edit is human-requested; the workflow never increments versions itself.
