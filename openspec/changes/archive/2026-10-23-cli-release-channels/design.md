# Design

## Context

See `proposal.md` for motivation. The release workflow currently runs only for `cli-v*` tag pushes, and `preflight()` requires a stable manifest version, an exact tag/version match, and reachability from `origin/main`. `publishRelease()` publishes to npm before reconciling a non-prerelease GitHub Release. These guards are operating as written, but they implement only the stable release line.

The reported [job](https://github.com/slax-lab/slax-reader/actions/runs/38527691198/job/115731837641) failed at `git merge-base --is-ancestor 2cd9da8ca692e6a278817ab1be25bdb851e98025 origin/main`. Dependencies, build, pack, consumer verification, artifact upload, and npm publication were all skipped. GitHub's existing [cli-v1.0.1 Release](https://github.com/slax-lab/slax-reader/releases/tag/cli-v1.0.1) has `target_commitish: dev`, `prerelease: false`, and no uploaded assets. This is an observed historical tag collision, not a requested version.

Implementation is isolated in the managed worktree on `ci/cli-release-channels`. The branch was refreshed from live `origin/dev` before final verification. The primary checkout remains untouched.

`reader-cli` has no living main spec yet. Its completed but unarchived migration delta contains tag-only publication and prerelease rejection requirements. This change introduces the distribution capability `cli-release` and intentionally supersedes those historical release clauses. The migration's later, separate archive must preserve its runtime/packaging requirements while referring distribution to `cli-release`, without restoring obsolete tag-only behavior. No concurrent task should change the same release capability.

## Goals / Non-Goals

**Goals:**

- Derive every release from an eligible merged branch event and its actual package version.
- Keep the tested archive, executable version, package metadata, channel, tag, and source revision consistent.
- Preserve the stable npm integration and useful partial-failure recovery.

**Non-Goals:**

- Incrementing versions automatically, merging promotion PRs, rewriting existing tags, or repairing old remote Releases during this task.
- Publishing dev/beta packages to npm, creating native standalone binaries, or changing the public CLI command behavior or update-channel selection.
- Re-running full PR validation on post-merge pushes.

## Decisions

### 1. A branch event initiates the entire release

Keep `.github/workflows/cli-release.yml` as the workflow identity, and replace its tag trigger with `push.branches: [dev, beta, main]`. Existing branch protection makes these post-merge events. Do not add workflow path filters; inspect the complete local Git diff instead, avoiding GitHub's path-filter diff limits and allowing explicit skip summaries.

The read-only detection phase reads `before` and `after` from the push event, verifies the canonical repository and exact branch ref, and checks out the event's `after` SHA. It compares `git diff before after -- apps/cli` and reads the manifest from both revisions. Release eligibility requires at least one CLI-directory change and a stable SemVer increase relative to the target branch's previous manifest. A version-only edit counts because `apps/cli/package.json` is in the CLI directory. Unchanged versions and unrelated merges are successful skips. Malformed identities/versions, version decreases, missing comparison revisions, branch creation/deletion, and non-fast-forward events fail closed rather than infer a release.

Version comparison is local to the destination branch. Promoting the same base version to beta/main does not require another version edit if it is newer than that destination's pre-merge version. Promotions can carry several versions; one event releases the resulting manifest version, not every intermediate version.

A tags-only architecture with an automatic tagging workflow was considered and rejected: [GitHub documents](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow) that tag pushes authenticated by `GITHUB_TOKEN` do not start another workflow. The originating run must perform both tagging and publication. Manual tag pushes cease to be a publishing entry point; retries rerun the original branch event.

### 2. Derive channel identity without committing prerelease versions

Let `V` be the stable version read from `apps/cli/package.json` at the event SHA. All versions below are computed values, not constants:

| Destination | Tag | Packed/executable version | GitHub state | npm |
| --- | --- | --- | --- | --- |
| dev | `cli-vV-dev` | `V-dev` | Pre-Release | None |
| beta | `cli-vV-beta` | `V-beta` | Pre-Release | None |
| main | `cli-vV` | `V` | Stable Release | Existing publish to `latest` |

Keep the package name `@slax-lab/reader-cli` and binary `reader-cli`. Keep standard packed filenames such as `slax-lab-reader-cli-V-dev.tgz`. Each tag has its own Release; a shared rolling dev/beta Release would lose version identity and is not part of this plan. The download is an installable npm `.tgz` plus `SHA256SUMS`, with generated release notes, matching today's distribution format.

The source manifest remains stable through promotion. After frozen dependency installation, the release preparation operation temporarily sets the derived package version and embedded release metadata, explicitly builds, and packs once inside a `try/finally` that restores the original manifest. This is necessary because `tsup.config.ts` embeds `pkg.version` into `__VERSION__`; changing only the archive filename or manifest after building would leave `reader-cli --version` incorrect. The packed identity includes base version, derived version, channel, source branch, source commit, and tag.

Extend exact-archive consumer verification to accept a validated expected release version. Default PR/package verification still compares against the source manifest. A preview archive must pass packed-manifest and installed-binary version checks for its derived version even after the source manifest is restored. Existing HTTP-fixture and outside-workspace installation checks remain.

### 3. Read-only build first, immutable tag and publication second

Detection and build jobs have `contents: read`. The build job checks event/repository/branch/version identity, checks reachability from the matching source branch, prepares the archive, runs its consumer smoke test, and uploads that exact archive plus release metadata/checksums as an Actions artifact.

A distribution job with `contents: write` rechecks the event identity, manifest, branch reachability, transferred artifact metadata, embedded package identity, and checksums. It creates the derived lightweight tag explicitly at the event SHA, only after validation. If the remote tag already resolves to that SHA, continue; if it points elsewhere, fail without changing it. Recheck tag identity before publishing or attaching assets. Keep checkout credentials disabled and use the workflow token for GitHub API writes.

Split preview distribution from stable publication so only the main publication job gets `id-token: write`, sets up the npm registry and installs the existing npm 12.2.0 client. The two jobs use the same validated artifact pipeline, and preview code cannot invoke registry queries or npm publication. Stable publication retains OIDC, provenance, `--access public`, exact tarball publishing and registry-byte verification. Keeping the calling workflow filename `cli-release.yml` preserves the existing [npm trusted-publisher identity](https://docs.npmjs.com/trusted-publishers/).

The new source guards use `origin/dev`, `origin/beta`, or `origin/main` according to channel. Stable publication continues to require reachability from main; the current failing guard is adapted for previews, not discarded.

### 4. Preserve partial-failure recovery and prevent replacement

Keep artifact metadata and checksums as the transfer boundary. Upload each build attempt under its own name and pass its immutable artifact ID through build job outputs to distribution; flatten the selected artifact into the expected directory. This avoids same-name upload conflicts on a full rerun while failed-job retries retain the successful original build output. A rerun of distribution reuses the original built artifact; a full rerun builds the same event SHA. Only matching identity and bytes permit a no-op or completion of missing outputs. A tag created before an npm/network failure remains available for the original event retry, without relying on a new tag event.

For dev/beta, create the GitHub Release with `prerelease: true` and `make_latest: false`. For main, retain stable npm-first ordering and the current latest-release guard. Release reconciliation checks the expected prerelease flag for the channel. Existing matching attachments are retained; missing ones are uploaded; duplicate/conflicting assets or Release state are errors. npm retries still verify source identity and registry archive bytes before skipping an already published version. Old unpublished stable versions cannot move npm latest backward.

Use channel-scoped workflow concurrency with `cancel-in-progress: false` and `queue: max` so dev, beta, and main do not cancel one another, and successive branch events wait rather than replace a pending release. [GitHub currently supports](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency) up to 100 pending runs with `queue: max`; execution order follows queue arrival rather than source-version order, so existing stale-stable-version rejection remains necessary.

### 5. Establish a prospective rollout

The workflow change by itself does not retroactively release the existing manifest version. The next qualifying CLI version increase starts the new automation. If only CLI code changes later while the version remains unchanged, no new release occurs; another publishable build requires a version increase. Fixed suffixes `-dev` and `-beta` are retained as requested, without sequence counters or commit suffixes.

The observed historical `cli-v1.0.1` tag must not be moved automatically. If the actual chosen future base version collides with an existing tag, fail with the expected/actual commit and explain the operator options. Prefer a new unused stable base version. Reusing a historical version would require a separate human-authorized cleanup after checking npm and all distribution state; the failed run alone does not prove the npm version is absent. The user subsequently authorized the first implementation PR to raise the base version from `1.0.1` to `1.0.2`, so that PR itself starts the dev test release. No automatic future version increments are introduced.

## Risks / Trade-offs

- [A suffix change only in archive metadata disagrees with the compiled version] → Derive the version before build, restore the source manifest afterward, and verify the installed executable from the final archive.
- [Tag rulesets prevent workflow-token creation] → Inspect applicable rulesets before rollout, document required actor permissions, and report a concrete permission error rather than add a long-lived token automatically.
- [An eligible event is retried after its branch advances] → Checkout and tag the immutable event SHA; require continued reachability from the matching branch, and validate remote tag identity.
- [npm succeeds while GitHub upload fails] → Reuse the tested artifact and verify existing npm identity/bytes before repairing only missing GitHub outputs.
- [A new stable run reaches publication ahead of an older run] → Serialize channel runs and retain latest-version guards; stale candidates fail without regressing latest.
- [More than 100 events fill a channel queue] → Document GitHub's queue limit and rerun canceled eligible events explicitly; do not claim an unbounded queue.
- [Preview upgrade commands currently use npm latest] → Document explicit archive installation for previews; adding npm dev/beta upgrade channels is outside this request.
- [The unarchived migration contains obsolete release rules] → Make the new distribution ownership explicit and reconcile that historical delta during its separately reviewed archive.

## Migration Plan

1. Review this proposal, specs, design, and tasks. No implementation or remote publication occurs before user confirmation.
2. Refresh the worktree from current origin/dev, implement on `ci/cli-release-channels`, run the relevant controlled tests and strict OpenSpec validation, and complete local pre-push review before any push.
3. Merge a task PR into dev through the existing repository process; propagate the workflow to beta and main through human-managed merge-commit promotions.
4. Check automated tag permissions and retain the existing npm trusted publisher. The explicitly requested bump to `1.0.2` in the implementation PR exercises dev on merge, then beta and stable on promotion. Verify actual npm OIDC integration only in the authorized stable release.
5. If publication must stop, pause Actions or revert the workflow through a task PR. Existing published artifacts/tags remain; do not unpublish or rewrite them as rollback.
