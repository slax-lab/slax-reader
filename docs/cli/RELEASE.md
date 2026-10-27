# CLI releases

Relevant pull requests run full CLI validation on Node 22.22.2, 24.15.0, and 26.12.1 in `.github/workflows/cli-ci.yml`. After a merge into `dev`, `beta`, or `main`, `.github/workflows/cli-release.yml` evaluates the complete push diff and the destination branch's previous CLI version. It releases only when `apps/cli/**` changes and `apps/cli/package.json` increases to a new stable SemVer. A version-only edit qualifies; CLI edits without a version increase and unrelated merges are successful skips.

## Channels and versions

The source manifest keeps the stable base version throughout `dev → beta → main`. The release version is derived at build time from the actual manifest value; no example version is hard-coded:

| Branch | Tag | Package and executable version | Distribution |
| --- | --- | --- | --- |
| dev | `cli-v<version>-dev` | `<version>-dev` | GitHub Pre-Release |
| beta | `cli-v<version>-beta` | `<version>-beta` | GitHub Pre-Release |
| main | `cli-v<version>` | `<version>` | npm latest and stable GitHub Release |

Each tag has its own Release in `slax-lab/slax-reader`. Downloads include `slax-lab-reader-cli-<release-version>.tgz`, `SHA256SUMS`, and generated release notes. The archive is an installable npm package, not a native standalone executable. GitHub's source ZIP/TAR downloads are the tagged monorepo, not the packaged CLI.

### CLI release descriptions

New Releases use an explicit CLI-scoped description rather than GitHub's repository-wide automatic PR list. Entries group changed CLI package/command files, shared contracts used by CLI, and CLI tooling/documentation, with source commit references. Unrelated Web, Extension, API, and Mobile changes and promotion PR summaries are excluded. A manifest-only release states the version update without claiming new features.

The comparison starts at the highest lower CLI base version in the same channel whose tag is an ancestor of the selected source. A first dev/beta release falls back to the highest lower ancestor stable CLI tag. If no applicable tag exists, the description identifies the first-release case and includes available CLI history. Other product tags and the current candidate tag do not become baselines. Missing or shallow history fails instead of producing broad fallback notes.

Preparation saves `RELEASE_NOTES.md` and binds its source, baseline, and digest to the transferred release metadata. Distribution verifies those notes against the selected history before writes. A partial-release retry uses the prepared description to create a missing Release, while asset reconciliation preserves an existing Release's description. This does not rewrite historical Releases automatically. GitHub's automatic source ZIP/TAR downloads continue to contain the whole tagged repository.

The [CI scope guide](../CI.md) explains which source and tooling changes run CLI compatibility or publication-fixture checks.

The first implementation PR deliberately raises the base version to `1.0.2`, so its merge into dev tests `cli-v1.0.2-dev`. Promotion then tests `cli-v1.0.2-beta` and `cli-v1.0.2`, provided each destination previously had a lower CLI version. Later versions are chosen explicitly in reviewed CLI PRs. Promoting an existing base version does not require another edit when it increases the destination's previous version. One promotion carrying several intermediate versions releases only the resulting manifest version.

## One-time setup

### npm trusted publisher

An administrator of `@slax-lab/reader-cli` must configure **Settings → Trusted publishing** on npmjs.com:

| Field | Value |
| --- | --- |
| Organization or user | `slax-lab` |
| Repository | `slax-reader` |
| Workflow filename | `cli-release.yml` |
| Environment name | Leave empty |
| Allowed actions | Enable direct `npm publish` |

Only main publishes to npm. Stage-only permission is insufficient for unattended direct publication. The workflow retains GitHub-hosted runners, Node 24.15.0, npm 12.2.0, public access and provenance. Trusted publishing requires npm >=11.5.1. Keeping the same workflow filename preserves its configured identity. The package repository URL must continue to match the monorepo.

Under the current npm policy, a new trusted publisher must complete its first successful publish within two days or it expires; create it near the planned stable release. Consult [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) for current external policy. Local tests do not verify the actual account configuration or OIDC exchange.

### GitHub permissions

No user-created Actions secret is required. Detection and build use `contents: read`; preview distribution uses `contents: write`; only stable publication adds `id-token: write`. GitHub API operations use `GH_TOKEN: ${{ github.token }}`. Checkout credentials are not persisted. Repository/organization policy must allow Actions and those job permissions.

The workflow automatically creates a lightweight tag at the validated merge revision. Applicable `cli-v*` tag rulesets must permit that workflow actor to create tags. A read-only inspection on 2026-10-14 reported the repository's `release-branches` branch ruleset and no tag ruleset, including inherited rulesets in the response; recheck policy if tag creation later returns a permission error. Do not add a personal access token or rewrite existing tags to work around a failure automatically.

Automatic tagging and distribution occur in the original branch workflow: [GitHub does not trigger another tag-push workflow from GITHUB_TOKEN writes](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow). Manually pushing a tag no longer initiates this release workflow.

## Release procedure

1. Choose a new stable SemVer and update `apps/cli/package.json` in a task PR targeting dev. Include all CLI changes intended for that version and run the checks in [CLI development](DEVELOPMENT.md).
2. Merge the reviewed PR into dev. **CLI release** detects the version increase, builds with the derived dev version, packs once, verifies that exact archive in an isolated consumer, then creates the dev tag and uploads the Pre-Release assets.
3. Download the `.tgz` and its checksum from the tag's Release. From the download directory, verify and install explicitly:

```bash
shasum -a 256 -c SHA256SUMS
npm install --global ./slax-lab-reader-cli-<release-version>.tgz
reader-cli --version
```

Replace `<release-version>` with the downloaded version, such as `1.0.2-dev`. Existing CLI upgrade/update checks use npm latest, so install preview archives explicitly.

4. Promote dev to beta, then beta to main through the repository's human-managed merge-commit promotion process. Beta gets its own Pre-Release. Main publishes the validated stable archive through npm Trusted Publishing, verifies registry bytes, and attaches the identical archive/checksum to the stable Release.

Release jobs do not repeat full PR typecheck, unit/integration or root tooling suites. They retain event/repository/manifest/version guards, matching-branch ancestry, explicit build, exact-archive installation smoke validation, and artifact/source/checksum validation. Tags point to the immutable event revision even if that branch advances while the run is queued. Invalid/missing comparison revisions, forced pushes, branch creation/deletion, decreases and identity mismatches fail without publication.

## Failures and retries

Use **Re-run failed jobs** on the original branch workflow run to reuse the validated artifact, or rerun the whole original event to rebuild the same revision. Build artifacts have an attempt-specific name, and distribution downloads the immutable artifact ID supplied by its successful build job. Failed-job retries reuse that build output; a full rerun creates a separate artifact without replacing the earlier one. Each channel has its own non-canceling concurrency group with `queue: max`. GitHub permits up to 100 pending runs per group; explicitly rerun canceled eligible events if that limit is reached. Queue arrival order is not guaranteed to match version order, so stable latest-version guards remain.

- An existing tag can be reused only if it resolves to the candidate commit. Conflicting or changed targets fail without moving/deleting the tag.
- An already published npm version is skipped only after embedded source identity, integrity and registry bytes match the candidate.
- Network/authentication/rate-limit failures are errors, not proof that a tag or npm version is absent.
- Missing Releases/assets are created; matching attachments are retained. Incorrect prerelease state, duplicate assets or conflicting bytes fail without overwrite.
- Dev/beta never publish to npm or replace stable GitHub latest. Old stable retries do not move npm or GitHub latest backward, and new unpublished stable versions must exceed npm latest.
- If npm succeeded but GitHub failed, repair the external issue and rerun the failed job; do not bump solely to repair missing attachments.

The previously observed `cli-v1.0.1` tag/empty Release is historical state and is not modified by this change. Prefer a new unused version when any chosen release version collides with a tag. Reusing a historical version requires separate human-authorized cleanup after checking all npm/GitHub state. Never automatically rewrite a published version or unpublish it.

## Verification boundary

Local and PR tests exercise real Git-history eligibility, derived versions, manifest restoration, reproducible archives, controlled npm/GitHub publication, checksum/source conflicts, failure recovery, and standalone installation. They do not create public tags, Releases or npm packages. The first authorized merge/promotion is required to verify workflow-token tag creation and stable npm OIDC integration end to end.
