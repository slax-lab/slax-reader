# Validation

Date: 2026-10-28. Branch: `feat/implement-migration-release-evidence` (delivery branch to be renamed `feat/enforce-expand-contract-release-safety`). Change: `enforce-expand-contract-release-safety`. Base: `dev` at `f217f465`.

## Approval and scope

Alex Lee approved the revised release-evidence architecture on 2026-10-28, and implementation started from revision `4445d30b`, imported unchanged by cherry-pick. This record covers the implementation. The SQL-semantic route stays withdrawn: the verifier has no SQL parser, statement whitelist, object-name cross-check, or replacement analysis, and it executes no DDL. An automated test asserts the module contains no SQL statement keywords.

## What was implemented

| Area | Files |
| --- | --- |
| Verifier and its fixtures | `tooling/migration-release-evidence.mjs`, `tooling/migration-release-evidence.test.mjs` |
| Checking surfaces | `.github/workflows/api-ci.yml`, `.github/workflows/api-deploy.yml`, `tooling/promotion-gate.mjs` |
| Scoping and local command | `tooling/ci-scope.mjs`, `package.json` |
| Ownership | `.github/CODEOWNERS` |
| Policy and documentation | `REVIEW.md`, `docs/CI.md`, `docs/BRANCHING.md`, `.rulesync/rules/api-commands.md`, `apps/api/AGENTS.md` (generated), `docs/api/DEVELOPMENT-DOCUMENT-EN.md` |
| Change artifacts | `proposal.md`, `design.md`, the three delta specs, `tasks.md`, this record |

The `dev` adoption commit is pinned to `f217f465c736a6b80621f78111e80ef6e833f27a`, the `dev` tip the branch was cut from; `origin/dev` still equalled it at commit time and the range contains no migration change.

Six decisions were made during implementation and recorded in the artifacts:

- The promotion surface enumerates the diff from the merge base and two recursive tree listings, because the compare API's `files` array is capped at 300 entries without pagination. Live evidence below.
- A migration present only in the adoption tree is frozen rather than current, so its first promotion to `beta` or `main` is not blocked and needs no declaration. The `migration-release-safety` delta gained a scenario for it.
- A migration propagated from a hotfix back to `dev` is not a re-add failure; the re-add rule applies only when the target is `beta` or `main`.
- The dev deploy re-checks declarations and immutability but not ownership, matching `design.md` §6 and the `api-release-deployment` delta. The `migration-release-safety` dev-deploy scenario said ownership runs; it was corrected to the design's reading, since the introducing pull request already required it.
- An added migration is a re-add only when the target branch already carried that path **before the release**, read at the merge's first parent (deploy), the pull request's base commit (API CI), or the base branch tip (promotion). Paths on other shared branches and in the adoption tree are historical. The first implementation compared against live branch tips, which broke normal beta deploys and beta-to-main promotions; the review finding and the corrected model are recorded below.
- Historical means **byte-identical**: an added path is frozen only when its blob identity equals the copy on the other shared branch or in the adoption tree. Different content under an existing path fails immutability and stays current, so declaration, ownership, and hotfix rules still apply; a hotfix's frozen copies are parsed too. The second implementation treated any existing path as historical, which let divergent content — including a `contract` reused through a hotfix — skip those rules.

## Commands and results

| Command | Result |
| --- | --- |
| `node --test tooling/migration-release-evidence.test.mjs` | 58 passed, 0 failed |
| `pnpm test:ci` | 141 passed, 0 failed |
| `pnpm test:preflight` | 104 passed, 0 failed, 2 skipped (win32-only cases) |
| `pnpm exec openspec validate --all --strict` | 79 passed, 0 failed |
| `pnpm agent:check` | `rulesync doctor --strict` and `generate --check` clean; OpenSpec 79/79; compiled agentic workflows match their sources |

## CLI verdicts exercised

Synthetic repositories (temporary Git repositories, no network):

| Case | Verdict |
| --- | --- |
| `--surface deploy`, `dev`, declared `expand` migration | pass, 1 migration path, 1 current |
| `--surface deploy`, `dev`, undeclared migration | fail, `declaration` naming the path |
| `--surface deploy`, `dev`, deleted migration | fail, `immutability` |
| `--surface deploy`, `dev`, `origin/main` not fetched | fail, `evidence`: the main branch tree is not fetched |

Live repository (read-only GitHub API; no database, deployment, or private configuration touched):

| Case | Verdict |
| --- | --- |
| `--surface promotion --base beta --head <dev tip>` on the real 300+ file batch | pass, 3 migration paths, 0 current (all adoption-era, frozen) |
| `--surface deploy` for the merge that added `20261027040000_collection_owner_hard_delete` | pass, 1 migration path, 0 current (frozen adoption-era file) |

Additional read-only runs after the review fix (see below), all passing:

| Case | Verdict |
| --- | --- |
| `--surface promotion --base beta --head <dev tip>` (repeated after the fix) | pass, 3 migration paths, 0 current |
| `--surface pull-request --base <beta tip> --head <dev tip>` | pass, 3 migration paths, 0 current |
| `--surface promotion --base main --head <beta tip>` | pass, 0 migration paths |
| `--surface deploy` for the last beta merge | pass, 0 migration paths |

The first case is the one that rejected the compare-file design: the same batch returns 300 files from the compare API and would have failed a literal 300-file gate.

## Live evidence that changed the design

| Observation | Source |
| --- | --- |
| The compare API caps `files` at 300 entries and does not paginate; `page=2` returns a body without `files` | `GET /repos/slax-lab/slax-reader/compare/beta...dev?per_page=100&page=1` returned 300 files and 64 commits; `page=2` returned the same comparison without a `files` array |
| The recursive tree endpoint accepts a commit SHA and lists the tree completely | `GET /repos/slax-lab/slax-reader/git/trees/<dev>?recursive=1` returned 4,656 entries, `truncated: false`, 130 migration files |

`design.md` §6 records the consequence: one compare call for `merge_base_commit`, two recursive tree listings for path and blob identity, and a fail-closed truncated listing.

## Pre-push review (`REVIEW.md`)

Passes run: Bugs, Security, Compliance.

Important findings and resolutions:

1. The deploy preflight called the GitHub API with only `contents: read`, so a `contract` in a `beta` or `main` release would have failed on HTTP 403. Granted the four read scopes in `api-deploy.yml`.
2. The promotion diff relied on compare `files` pagination that does not exist, and the cap would have blocked every promotion larger than 300 files. Replaced with the merge-base tree diff.
3. An adoption-era migration still on its way to `beta` was treated as a re-added frozen file, which would have blocked the next real promotion. Added paths that exist only in the adoption tree are now frozen, not current.
4. A hotfix migration propagated from `main` to `dev` was a re-add immutability failure. The re-add rule now applies only to `beta` and `main` targets.
5. `git diff --name-status -z` rename parsing read the old and new paths in reverse order. Fixed and covered by a real-repository fixture.

No security finding: no secret is read, printed, or copied; every failure reports a fixed stage plus a public path, pull-request number, commit SHA, or branch name; the check mutates nothing remote and only performs read-only Git fetches.

### Review round 2 (independent review)

**Finding.** The added-migration re-add rule rejected a normal `beta` deploy and a `beta` → `main` promotion, because it compared an added path against the live branch tips: the target branch already contains the merge being deployed, and a promotion's source branch already contains every migration it carries.

**Root cause.** `verifyReleaseEvidence` asked `pathExists('main' | 'beta', path)` for every added migration. That is the post-release target on a deploy and the source branch on a promotion, so both flows always looked like re-adds.

**Fix.** The target is now read at its pre-release state, passed in as `targetCommit`: the merge's first parent for a deploy, the pull request's base commit for API CI, and the base branch tip for a promotion (still unmerged, so it is pre-release). Only the target can produce a re-add. Every other shared branch, and the adoption tree, makes an added path historical/frozen: no new declaration, no failure. `createGitEvidence.pathExists` accepts a commit SHA so the pre-release tree can be read without fetching another ref.

**Regressions added.** `a normal beta deploy of a new migration passes although beta now contains it` (unit) and `the CLI judges a beta deploy target at the pre-release parent` (CLI over a synthetic repository whose `origin/beta` already points at the merge); `a beta-to-main promotion passes when the migrations come from beta`; `a beta-to-main promotion whose migrations already live on beta passes as frozen` and `a dev-to-beta promotion whose migrations came from main is frozen` (promotion gate); `an actual re-add of a path the target already carried fails on immutability` and `an actual re-add on the target branch fails the promotion`.

**Artifacts updated.** `design.md` §5 (current / historical / re-add), `docs/CI.md`, and the `migration-release-safety` delta now state the pre-release-target rule plus three scenarios: a normal beta deploy, a beta-to-main promotion carrying beta's migrations, and a genuine re-add.

### Review round 3 (independent review)

**Finding.** Historical paths were frozen on path existence alone, so a file that diverged from the shared-branch or adoption copy was accepted without a declaration, an approval, or the hotfix class rule.

**Root cause.** The added-path branch compared only the path's presence (`pathExists`) against the other shared branch and the adoption tree; it never compared content.

**Fix.** Path identity is now a blob identity: `evidence.fileSha(ref, path)` returns the blob hash from Git (`rev-parse <ref>:<path>`) or from the GitHub contents API (`sha`), which share one hash space. An added path is historical only when every copy it finds is identical to the release head; any divergent copy records an immutability finding and leaves the file current, so the declaration, ownership, and contract checks still run. The hotfix class check now parses frozen and re-added copies as well, and a frozen copy without a declaration fails instead of being exempted. `createGithubEvidence` resolves `HEAD` to the release head SHA so the promotion surface reads the same content reference.

**Regressions added.** `divergent content under an existing path fails immutability and stays current` (promotion, beta deploy, and adoption copies), `a hotfix that diverges from a shared copy cannot skip the declaration` (the reviewer's exact reproduction: same path on beta, different undeclared head content, both findings and a real content read), `divergent content under an existing path fails the promotion` (promotion gate over contents-API fixtures), and `a hotfix cannot ship a non-expand migration by reusing a shared copy` (byte-identical contract, plus a divergent non-expand file that reports both findings). The existing identical-history cases for a beta deploy and a beta-to-main promotion remain and still pass.

### Review round 4 (independent review)

Two findings, both fixed.

**Finding 1 — API CI could not satisfy ownership before the merge.** The ownership check only accepted a *merged* introducing pull request. API CI runs on the pull request that adds the migration, so no merged pull request ever introduced the path under test and the check failed closed for every new migration.

*Fix.* `verifyReleaseEvidence` accepts `currentPullRequest` on the pull-request surface. The current open pull request is the introducer, verified by `state: open`, `head.sha` equal to the release head, and `base.ref` equal to the release branch; its named-owner `APPROVED` review must already exist. `createGithubEvidence.currentPullRequest` reads it, the CLI gained `--pull-request`, and the API CI job passes `github.event.pull_request.number`. Promotion and deploy keep resolving exactly one merged introducing pull request.

*Regressions.* `API CI accepts the current open pull request as the introducing pull request` (passes with a named-owner approval, fails with an outsider, and never calls the merged lookup), `the current pull request must be open, at the release head, and target the base` (closed, merged, another head, another base), and `promotion and deploy still require merged introducing provenance` (the deploy and promotion surfaces use the merged lookup, ignore the current pull request, and fail when provenance is unmerged).

**Finding 2 — a same-commit web success hid a newer API failure.** `resolveServingCommit` deduplicated by commit before attributing a deployment record to `api-deploy.yml`. A newer `web-deploy` record for a commit consumed that commit, so the older API record for the same commit was skipped and the resolver fell back to an older successful commit.

*Fix.* The resolver now reads a record's latest status, attributes it to `api-deploy.yml`, and evaluates the run conclusion and the `Migrate databases and deploy Workers` step **before** deduplicating by commit. A web record is skipped without consuming the commit; the first evaluated API record decides.

*Regressions.* `a same-commit web success never hides a newer API failure` (web success newest, API failure for the same commit, older API success → freezes on the failure) and `a same-commit web record does not consume the commit before the API record is read` (web success then API success for the same commit → resolves that commit).

**Artifacts updated.** `design.md` §3 (open current pull request on API CI) and §4 (attribute and evaluate before deduplicating), `docs/CI.md`, the `migration-release-safety` delta (ownership scenarios for the open pull request and a same-commit web deployment scenario), and `tooling/ci-workflow.test.mjs` (the job passes `--pull-request` and `PR_NUMBER`).

### Review round 5 (independent review)

**Finding.** `verifyReleaseEvidence` resolved `currentPullRequest` before iterating the diff, so an empty or historical-only migration diff still called the pull-request endpoint and failed closed when it was unavailable — a release that asked nothing of that endpoint was blocked by its outage.

**Fix.** The resolution moved inside the ownership loop and is memoized: it runs on the first current migration that has a valid declaration and needs ownership evidence, and one result serves every path. An empty diff, a historical-only diff, and a dev deploy that skips ownership never call it; a failing call is still recorded once and fails closed when a current migration does need it.

**Regressions.** `an empty or historical-only diff never reads the current pull request` (the fixture throws if called), `the current pull request is read once for every current migration` (two current migrations, one call), and two CLI cases: `the CLI never reads the current pull request for an empty diff` (a fetch stub that throws is never reached) and `the CLI stays green when the pull-request endpoint is down and the diff is historical` (503 on `/pulls/`, an adoption copy served from contents, `ok: true`, no `/pulls/` request).

**Artifacts updated.** `design.md` §3, `docs/CI.md`, and the `migration-release-safety` delta (lazy read plus the "no current migration needs ownership evidence" scenario).

### Review round 6 (PR #421 automated review)

Five items, all fixed.

1. **Promotion integrity could not use the open pull request.** The promotion gate runs before its merge, and a `hotfix/*` head introduces its own migration, so merged provenance was unavailable there. The promotion surface now resolves the current open pull request (open state, head SHA, base ref) exactly like API CI; the deploy surface still requires merged provenance. Regressions: `promotion uses the open pull request before the merge and deploy requires merged provenance`, `a hotfix promotion carries an expand migration before the merge` (unit) and two promotion-gate cases: a hotfix expand migration passes before the merge, and a hotfix contract still fails.
2. **`hotfix/*` → `dev` was trailer-exempt.** Only real sync-backs (`dev` ← `beta`/`main`) and promotions are exempt now; a hotfix propagated to dev carries its own content and needs the trailer. The existing `trailerExempt` assertion was corrected.
3. **Unreachable deployment dedupe removed.** The `evaluated` set could never trigger because the first attributed API record returns and failures throw. It is gone; the resolver is documented as "the first record attributed to the API workflow decides, and older records for the same commit are never consulted". `design.md` §4 and the delta say the same.
4. **`git readMigration` ignored its ref.** It now reads the requested revision when it is available locally and falls back to the checkout's `HEAD` only when a fork head was never fetched. Regression: `git readMigration honors the requested revision` reads an older commit's content while HEAD holds a different one.
5. **Re-add wording.** The delta, `design.md` §5 and `docs/CI.md` now state the recorded restriction: the rule applies only to `beta` and `main` targets, and a `dev` target never applies it because a hotfix migration legitimately arrives there. A scenario covers it.

## Machine facts versus owner judgment

| Checked by the machine | Left to the approving owner and reviewer |
| --- | --- |
| Declaration presence, class, and field shapes | Whether the class is honest |
| Named-user owner `APPROVED` on the introducing pull request | Whether the approver read the SQL |
| Added/deleted/renamed/modified paths, a re-add at the pre-release target, and copy identity | Whether the migration is safe for the data |
| Prerequisite merge SHA, trailer, and ancestry | Whether the prerequisite removed the last dependency |
| Latest successful `api-deploy` deployment per environment | Whether serving code matches that deployment |
| Hotfix class, adjudicated field set | Whether the incident justifies adjudication |
| Nothing about SQL semantics | `removes`, `preserves`, `reason`, rollback confirmation |

## Declared gaps

- **Branch name.** The Tower worktree branch is `feat/implement-migration-release-evidence`; it must become `feat/enforce-expand-contract-release-safety` before the pull request opens, which is why `tasks.md` 1.2 stays unchecked. The mission records the rename as a tower-side action.
- **No live release was executed.** No database, Cloudflare resource, or GitHub deployment was touched. The three surfaces are covered by workflow-shape tests and by the CLI over real Git data; their first real execution is the first release after merge.
- **Ownership, reviews, and the deployment resolver are fixture-tested only.** The live run exercised the tree diff and the adoption-tree lookup. Reviews, `CODEOWNERS` at the base commit, prerequisite ancestry, and the deployment resolver were exercised against synthetic API responses because no test pull request was opened.
- **The adoption commit can go stale** if a migration merges to `dev` between this branch's cut and its merge; such a file would be treated as current and need a declaration. Re-run `git rev-list --count f217f465..origin/dev -- apps/api/prisma` before merging and bump `adoptionCommit` to the then-current `dev` tip if it is nonzero.
- **Rollback visibility.** An out-of-band `wrangler rollback` is invisible to the check by design; `REVIEW.md` carries the reviewer's redeploy confirmation.
- **No package-version bump.** API and Web deployment do not use package-version increments (`docs/release/VERSIONING.md`).

## Review status

Committed for independent review. No push and no pull request until that review is clean.
