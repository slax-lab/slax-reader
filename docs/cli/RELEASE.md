# CLI releases

`.github/workflows/cli-ci.yml` validates relevant pull requests on Node 22.22.2 and 24.15.0. It does not run again on post-merge pushes to `dev`, `beta` or `main`. `.github/workflows/cli-release.yml` publishes stable CLI releases when a `cli-v<version>` tag is pushed; it builds without repeating typecheck, CLI unit/integration suites or root tooling tests.

## One-time setup

### npm trusted publisher

An administrator of `@slax-lab/reader-cli` must open the package's **Settings → Trusted publishing** on npmjs.com and add a GitHub Actions publisher:

| Field | Value |
| --- | --- |
| Organization or user | `slax-lab` |
| Repository | `slax-reader` |
| Workflow filename | `cli-release.yml` |
| Environment name | Leave empty |
| Allowed actions | Enable direct `npm publish` |

Stage-only permission is not enough for this unattended workflow. The workflow uses GitHub-hosted runners, Node 24.15.0 and npm 12.2.0 (trusted publishing requires npm >=11.5.1). Public OIDC publication includes provenance. The package's repository URL must continue to match `slax-lab/slax-reader`.

Under the current npm policy, a new trusted publisher must complete its first successful publish within two days or it expires; create it near the planned first release. Refer to the [current npm trusted publishing documentation](https://docs.npmjs.com/trusted-publishers/) for policy updates.

### GitHub Actions secrets and permissions

**No user-created Actions secret is required.** Do not add `NPM_TOKEN`, a personal access token, or a Reader API key for this workflow.

- npm authenticates using short-lived OIDC credentials through `id-token: write`.
- GitHub Release operations use `GH_TOKEN: ${{ github.token }}`, the automatically supplied workflow token, with `contents: write`.
- The build job remains read-only. Publishing permissions apply only to the publish job after validation.
- Ensure repository/organization policy permits those job permissions and Actions execution. Restrict creation, updates and deletion of `cli-v*` tags to release maintainers through repository rulesets. If you later add a GitHub Environment, its name must also match the npm trusted publisher; this workflow currently uses none.

These external settings are not created by local installation or tests. A passing dry test is not proof that the npm trust is configured.

## Release procedure

1. Choose a new stable SemVer and update `apps/cli/package.json` in a task PR targeting `dev`. The imported version is `1.0.0`; do not republish that existing upstream version. The raised Node requirement is a compatibility change to consider when selecting the next version.
2. Run the checks in [CLI development](DEVELOPMENT.md), then promote through `dev → beta → main` using the repository's human-reviewed promotion process. Confirm the public skill URL is available.
3. Fetch the promoted commit and create a matching tag on that commit, for example `cli-v2.0.0`. Push that tag intentionally. Tag creation/push is the publication action; the workflow never increments versions, creates tags or merges branches for you.
4. Monitor **CLI release** in GitHub Actions. All gates run on the tagged revision. A tag must match the package manifest and point to a commit reachable from `main`. Branch pushes, malformed tags and prerelease versions do not publish.

Full source validation belongs to PR CI and the reviewed promotion process; the release job does not rerun those suites or independently re-prove them on the final merge SHA. The release workflow checks the tag, installs frozen dependencies, explicitly builds, packs once, smoke-checks that exact archive in an isolated consumer, transfers it to the publishing job, then publishes it with `npm publish`. After registry integrity verification it creates the tag's Release in `slax-lab/slax-reader` and uploads:

- `slax-lab-reader-cli-<version>.tgz`: the same bytes published to npm;
- `SHA256SUMS`: SHA-256 checksum for the archive;
- generated release notes.

GitHub also provides its normal source ZIP/TAR downloads for the tagged monorepo. The npm archive is the installable CLI package, not a standalone native executable.

## Failures and retries

Use **Re-run failed jobs** to reuse the tested artifact, or rerun the whole workflow on the same unchanged tag. Releases are serialized per package; an active release is not canceled by a newer tag.

- An already published npm version is skipped only when its integrity and embedded source identity match the candidate; registry archive bytes are verified too.
- Authentication/network errors are failures, not evidence that a package version is missing.
- Missing GitHub Releases/assets are created; existing matching assets are retained. Conflicting bytes fail without overwrite.
- Old retries do not move npm `latest` or GitHub's latest release backward. A new unpublished version must be newer than npm latest.
- Never rewrite a published version/tag or unpublish automatically. Fix a defect using a new reviewed version. If npm succeeded but GitHub failed, do not bump solely to repair attachments: rerun the failed job after correcting the external issue.

## Verification boundary

Local and PR tests validate release guards, exact archive packaging, controlled npm/GitHub orchestration, failure recovery, checksum conflicts and isolated CLI installation. They do not publish public packages, configure npm trust, create remote tags or verify a real OIDC exchange. The first authorized release is still required to verify that external integration end to end.
