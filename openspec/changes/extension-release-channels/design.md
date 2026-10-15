# Design

## Context

See proposal.md for motivation. `.github/workflows/frontend-ci.yml` validates extension types/tests for relevant PRs and main pushes; it does not build a distributable ZIP or create Releases. `.github/workflows/cli-release.yml` already separates read-only detection/build from privileged GitHub distribution, compares full push history, and requires a stable source version increase.

The extension uses WXT 0.21.4, a numeric package version initially 1.16.2, existing preview/beta/production public manifest keys, and the root `pnpm extension -- zip` entry point. The human subsequently requested a patch bump to 1.16.3 and full packaging verification. `tooling/web-pages-deploy.mjs` establishes dev → preview, beta → beta, main → production. The new managed worktree is on ci/extension-release-channels, cut from origin/dev; the previous PDF worktree is separate.

Read-only GitHub inspection found existing dev, beta and main Environments but no EXTENSION_BUILD_CONFIG variable in them. The human subsequently requested reuse of WEB_BUILD_CONFIG and supplied its public shape; a fresh inspection confirmed main also has that variable. Existing Web configuration is consumed without changing remote variables.

## Goals / Non-Goals

**Goals:** Reuse CLI release semantics, preserve installable Chrome identity, make skip/build/publication outcomes explicit, and distribute only the verified merged-source archive.

**Non-Goals:** Store publication, npm, signing, automatic versioning, runtime feature changes, branch promotion changes, or cleanup of historical tags/Releases. The explicit human-requested 1.16.3 bump is included; no retrospective release is included.

## Decisions

### 1. Use the complete branch push comparison and prove the merged PR

Add extension-release.yml for pushes to dev, beta and main. Read event before/after revisions and inspect the complete local Git diff, as CLI does, instead of relying on GitHub path-filter file limits. Local selection first checks the canonical repository, event/ref/SHA agreement, available ancestor history, source manifest identity, extension-directory changes and version increase. Unchanged versions and unrelated changes skip before packaging.

For a locally eligible event, verify an associated merged PR whose base repository/branch and merged commit match the event. This makes the requested PR-merge condition explicit, including an administrator's otherwise possible direct push. Missing merge association skips; transient GitHub failures are errors with bounded retry, not evidence of an eligible or absent PR. Never build an unmerged PR head under a publishing context.

Use the event SHA throughout and require continued reachability from origin/<branch>; a queued release need not still be the branch tip. Compare against the destination's pre-push package version so a normal promotion can release the same base version on the next channel.

### 2. Separate release names from Chrome's numeric version

Let V be the stable three-part version in apps/extension/package.json, also satisfying Chrome's numeric component bounds. Reject prerelease source versions, decreases and invalid Chrome versions.

| Branch | Runtime profile | Tag | Manifest version | Display version | GitHub state |
| --- | --- | --- | --- | --- | --- |
| dev | preview | ext-vV-dev | V | V-dev | Prerelease |
| beta | beta | ext-vV-beta | V | V-beta | Prerelease |
| main | production | ext-vV | V | V | Stable |

[Chrome requires numeric version components and supports descriptive version_name](https://developer.chrome.com/docs/extensions/reference/manifest/version). Do not copy the CLI's temporary prerelease package-version mutation into the Chrome manifest. Instead generate a temporary WXT configuration that extends the existing configuration, supplies the release display name and isolated output directory, and retains all current profile keys. Ordinary local builds keep their current behavior.

Name the download slax-reader-extension-<release-version>-chrome.zip. A recipient extracts it and loads the unpacked directory; this is not a signed CRX or a store auto-update feed.

WXT omits version_name when it equals the numeric version. Archive validation accepts that omission for main, where Chrome falls back to version; dev/beta still require their exact suffixed version_name. This was verified against actual channel builds.

### 3. Supply explicit public profile configuration

The build job selects the existing GitHub Environment named by the destination branch. By default it reads WEB_BUILD_CONFIG, validates the public Web schema, copies PUBLIC_BASE_URL, AUTH_BASE_URL, SHARE_BASE_URL, COOKIE_DOMAIN and COOKIE_TOKEN_NAME, and maps DWEB_API_BASE_URL to EXTENSIONS_API_BASE_URL. OAuth, Stripe, Turnstile and push settings are not forwarded to the extension build.

A nonempty EXTENSION_BUILD_CONFIG takes precedence as a complete configuration override; an invalid override fails rather than silently falling back or merging sources. Its required values are PUBLIC_BASE_URL, AUTH_BASE_URL, SHARE_BASE_URL, EXTENSIONS_API_BASE_URL, COOKIE_DOMAIN and COOKIE_TOKEN_NAME. Optional values are a public analytics measurement ID and uninstall-feedback URL. Reject unknown keys for the selected source schema, multiline/non-string values, embedded URL credentials, and non-HTTPS extension release endpoints. Do not accept analytics API secrets or publication credentials as public build values.

Validate against the existing extension schema plus release-specific restrictions, and inject only an explicit environment allowlist into build subprocesses. The branch owns SLAX_ENV; configuration cannot choose another profile or override the source version. Clean CI checkout requires no ignored local environment files. Missing public configuration fails before any tag creation; populate it during rollout using operator-confirmed values rather than guessing or copying Web settings wholesale.

### 4. Package with read-only permissions before publishing

Keep read-only detection, build and distribution jobs separate. Detection has the read permissions needed for source/merged-PR verification. The build installs frozen dependencies with the repository's pinned toolchain, invokes the root extension ZIP command with the temporary release configuration, and inspects the actual archive. Validate safe archive entries, manifest version/display name, expected profile key/ID, referenced extension resources and SHA-256. Retain normal PR validation; do not repeat the entire monorepo suite after merge.

Transfer ZIP, SHA256SUMS and release.json through an attempt-specific Actions artifact and pass the immutable artifact ID to distribution. Metadata records repository, event SHA, branch, profile, base/display versions, tag, expected extension ID, filename and ZIP hash. Distribution revalidates event/source and artifact identity before obtaining any tag or Release side effect. Only that job has contents:write; it needs no id-token permission or external publishing secret.

Create the tag at the exact merged SHA, then create/reconcile its Release and attach the ZIP/checksum. Keep the whole operation in the originating workflow because workflow-token tag writes do not start another tag-push workflow. Existing CLI GitHub tag/asset reconciliation is the reference; avoid changing CLI publication behavior as part of this task.

### 5. Keep publication immutable and retryable

An existing tag is acceptable only when it resolves to the intended commit. Existing releases must match tag and prerelease state. Matching asset bytes are retained and missing outputs are uploaded; duplicate names, conflicts, permission failures and unexpected responses are errors, never reasons to overwrite. Do not roll tags forward for another merge using the same version.

Use branch-specific non-canceling concurrency, matching the CLI queue convention, and immutable build artifact IDs. Retrying a failed distribution uses its successful original build. A full rerun may rebuild the same revision; conflicting bytes remain an explicit failure rather than replacing a published archive. Keep make_latest false for every extension Release to avoid taking over the monorepo's CLI Latest selection; stable extension releases remain non-prerelease Releases discoverable by their ext-v tags.

## Risks / Trade-offs

- Missing public environment configuration → document the six required values and fail before tag/publication; all three configurations need setup before the first eligible merge.
- Channel suffix makes a package non-installable → retain numeric manifest.version and validate version_name in the final ZIP.
- PR association is briefly unavailable after merge → bounded read-only retry, then a visible failure/skip without packaging an unverified source.
- Source or artifact changes while queued → validate immutable event SHA, branch ancestry, artifact metadata and exact bytes at distribution.
- Existing version/tag/assets collide → fail without mutation; choose a new reviewed base version rather than rewriting history.
- Public config changes during retries → reuse the successful build artifact; a different full rebuild must not replace already published bytes.

## Migration Plan

1. Review this proposal, spec, design and tasks before implementation.
2. Implement and validate on ci/extension-release-channels; prepare the task PR targeting dev, including the human-requested extension version bump to 1.16.3.
3. Reuse WEB_BUILD_CONFIG in each destination Environment, or optionally configure a complete EXTENSION_BUILD_CONFIG override when its extension endpoints differ. Never copy production values to another channel automatically. Publish no tag or Release as part of local testing.
4. Merge the workflow through the normal process and promote it with existing human-managed merge-commit promotions. This PR's explicit version increase exercises dev after merge, followed by beta/main promotion.
5. Stop future publication by reverting/disabling the workflow. Keep already published tags and assets intact.
