# Extension releases

The [Extension release workflow](../../.github/workflows/extension-release.yml) packages Chrome ZIPs after merged PRs reach `dev`, `beta` or `main`. It uses the same stable source-version increase rule as the CLI. It publishes to [GitHub Releases](https://github.com/slax-lab/slax-reader/releases).

## Eligibility and channels

Both conditions must hold across the complete push's before/after comparison:

1. `apps/extension` changed, including a package-version-only change.
2. `apps/extension/package.json` has a greater stable three-part version than the destination branch previously had.

The workflow also verifies a merged PR targeting that repository and branch with the exact event SHA. Unrelated or unchanged-version merges skip successfully. Invalid source identity, missing history, forced pushes and version decreases fail. A transient PR association lookup is retried before a build can start. Direct pushes without a matching merged PR skip. No version is incremented automatically.

For source version `1.16.3`:

| Destination | Build profile | GitHub tag | Display version | Release state |
| --- | --- | --- | --- | --- |
| `dev` | `preview` | `ext-v1.16.3-dev` | `1.16.3-dev` | Prerelease |
| `beta` | `beta` | `ext-v1.16.3-beta` | `1.16.3-beta` | Prerelease |
| `main` | `production` | `ext-v1.16.3` | `1.16.3` | Stable |

Chrome's `manifest.version` stays `1.16.3`; `version_name` carries the channel display version. WXT omits a redundant stable `version_name`, so Chrome displays `version` on main. Source versions must satisfy Chrome's numeric component bounds (0–65535, with a nonzero version). Existing public manifest keys preserve the preview, beta and production extension IDs. Promotion compares against the destination's previous version, so the same base version can progress through all three channels without additional version edits. Use merge commits for promotion as required by the repository branching rules.

## One-time public configuration

The build selects the destination Environment (`dev`, `beta` or `main`) and reuses its existing **variable** `WEB_BUILD_CONFIG` by default. There is no need to create a separate extension variable when its URLs and session settings match the Web app. Repository-level variables follow GitHub's normal Environment precedence; values are never copied between channels automatically.

| Web field | Extension field |
| --- | --- |
| `PUBLIC_BASE_URL` | `PUBLIC_BASE_URL` |
| `AUTH_BASE_URL` | `AUTH_BASE_URL` |
| `SHARE_BASE_URL` | `SHARE_BASE_URL` |
| `DWEB_API_BASE_URL` | `EXTENSIONS_API_BASE_URL` |
| `COOKIE_DOMAIN` | `COOKIE_DOMAIN` |
| `COOKIE_TOKEN_NAME` | `COOKIE_TOKEN_NAME` |

The Web JSON is validated against its existing public schema, then only those six fields are forwarded. OAuth, Stripe, Turnstile and push configuration are excluded from the extension subprocess.

If extension settings need to differ, add an optional `EXTENSION_BUILD_CONFIG` variable in GitHub **Settings → Environments** for that destination. A nonempty value replaces the entire configuration source; an invalid override fails without falling back to Web values or merging fields. All six fields below are required in an override. These are placeholders, not usable deployment settings:

```json
{
  "PUBLIC_BASE_URL": "https://reader.example.test",
  "AUTH_BASE_URL": "https://reader.example.test",
  "SHARE_BASE_URL": "https://share.example.test",
  "EXTENSIONS_API_BASE_URL": "https://api.example.test",
  "COOKIE_DOMAIN": ".example.test",
  "COOKIE_TOKEN_NAME": "slax_session"
}
```

The optional extension override fields are `GOOGLE_ANALYTICS_MEASUREMENT_ID` and `UNINSTALL_FEEDBACK_URL`. Extension release URLs must use HTTPS and contain no embedded credentials or fragments. Values must be single-line strings. Unknown fields for the selected schema, `SLAX_ENV`, analytics API secrets and publishing credentials are rejected. The branch selects the runtime profile. Match the Web session-cookie configuration and configure its existing extension/bridge allowlist for that profile's extension ID. See [development configuration](development.md#configuration-location) for field ownership.

Missing or invalid configuration stops packaging before a tag or Release is created. Build subprocesses receive only public values and a small system environment allowlist; ignored local configuration files are neither required nor used for CI releases. The release tool refuses to build when selected `deploy/local/.env.extension*` files exist. CI uses frozen dependencies, Node 24.15.0, pinned pnpm, and Python 3's standard library for ZIP inspection.

The workflow token needs `contents: read` and `pull-requests: read` for detection, read-only repository access during build, and `contents: write` plus `pull-requests: read` during publication. No external publication token is required. Existing Environment approval policies still apply to the build job.

## Publishing a version

1. Prepare an extension PR from `origin/dev` with the intended changes and an explicit stable `apps/extension/package.json` version increase. Update the lockfile through pnpm if the package metadata requires it. There is no version bump solely to introduce this workflow.
2. Run ordinary extension validation and `pnpm test:extension-tooling`, then merge through normal review.
3. Inspect the Extension release Actions run. Detection reports eligibility or the skip reason. Eligible builds reuse the destination's public Web configuration (or complete extension override) and generate an isolated WXT package.
4. Download the ZIP and `SHA256SUMS` from the corresponding `ext-v...` Release. Promote through the existing `dev` → `beta` → `main` process for subsequent channels.

Each Release contains `slax-reader-extension-<display-version>-chrome.zip` and `SHA256SUMS`. An attempt-specific Actions artifact also retains `release.json` with repository, immutable source SHA, branch, profile, versions, extension ID and ZIP hash. Publication downloads the successful build by immutable artifact ID, verifies the event/source and actual archive again, then creates the tag at that exact merged SHA. The ZIP inspector checks entries, CRC, manifest identity and referenced resources. No npm package or browser-store upload is performed. Extension Releases explicitly preserve the monorepo's existing **Latest** selection, so locate stable extension releases by their `ext-v` tags rather than the global latest-release endpoint.

## Installing a ZIP

Verify the checksum before extracting (for example `shasum -a 256 -c SHA256SUMS` in the download directory). Keep the extracted files in a persistent directory. Open `chrome://extensions`, enable **Developer mode**, select **Load unpacked**, and choose the directory containing `manifest.json`. Replace that directory's contents and reload the extension for a manual update. The ZIP is an unpacked extension distribution, not a signed CRX or automatic update feed.

## Retry and recovery

Branch-specific non-canceling concurrency preserves queued event identities. A queued event may release its original SHA after the branch advances, provided that SHA is still in the branch's history.

For a failed publication, use **Re-run failed jobs** while its successful build artifact is retained (30 days). This reuses the original ZIP. Matching tags and asset bytes are accepted; missing assets are uploaded. If an upload response was lost, a retry checks the remote bytes before deciding whether to upload. Authentication/API failures, moved tags, duplicate asset names, incorrect Release state and differing bytes stop publication. Existing assets and tags are never overwritten or deleted by this workflow.

A full rerun rebuilds the revision using current public configuration. If those bytes differ from an already published asset, it fails explicitly; use the retained artifact for recovery. For a required content/configuration correction, submit a new PR with a new version rather than reusing or moving a published tag. Disable/revert the workflow to stop future releases; leave published tags and assets intact. An application rollback should be delivered as a reviewed revert with a greater extension version.

## Rollout status for this change

The operator requested reuse of the existing `WEB_BUILD_CONFIG` variables. Verify each destination's Web JSON before the first eligible version merge; a separate extension override is optional. Local verification uses synthetic public configuration and does not establish live Web/API integration. Implementation validation creates no real release tag or GitHub Release.
