# Tasks

## 1. Merge eligibility and environment selection

- [x] 1.1 Add a repository workflow-policy helper for qualifying merged events, repository identity, merged SHA, and `dev`/`beta`/`main` mapping; verify synthetic tests reject open/unmerged PRs, pushes, manual calls, mismatched environments/revisions, and malformed events while accepting merged fork contributions.
- [x] 1.2 Add `api-deploy-on-merge.yml` and independently guard the reusable executor before checkout/credential use; verify workflow syntax and policy tests prove that only merged `closed` events call deployment and checkout uses the resulting merged commit.
- [x] 1.3 Remove arbitrary manual deployment, routine-bootstrap, and caller-selected private configuration inputs, limit reusable secret declarations/passing, and retain root API command invocation; verify no in-repository caller retains removed inputs and tests show incomplete prerequisites fail without remote calls or private values in diagnostics.

## 2. Pinned configuration and release concurrency

- [x] 2.1 Validate protected checkout selectors and the private declarative manifest/native configuration, including immutable revision, contained paths, explicit optional Wrangler environment, Tunnel hostname, and account consistency; verify synthetic fixtures reject mutable refs, path traversal, malformed hosts, missing values, account mismatch, embedded credentials, and executable configuration without displaying supplied values.
- [x] 2.2 Configure independent test locking and a shared beta/production executor lock with cancellation disabled; verify workflow checks cover both production environments and exclude a duplicate caller lock.
- [x] 2.3 Verify target-branch currency at release start and immediately before remote access, and record only public source provenance/stage results; verify fake branch lookups cover current tip, newer tip, lookup failure, production execution under the default-branch event context, and old-run retries without disclosing private configuration revisions.
- [x] 2.4 Fetch configuration only from a verified private repository with a narrowly scoped Actions Secret, fixed revision, temporary storage, and no persisted credentials; verify fake repository/checkout cases reject public or unverifiable repositories and keep repository/ref/path, authorization values, response bodies, and commit subjects out of public output.

## 3. Database access and migration lifecycle

- [x] 3.1 Preserve offline install/generation/lint/typecheck/test/build before the remote phase with placeholder generation URLs and no unnecessary credential injection; verify isolated command traces show build failure never opens firewall access, starts a Tunnel, or migrates, and ordinary PR checks use only public generic/synthetic configuration.
- [x] 3.2 Add bounded public-IP/firewall handling and an owned Tunnel process with authenticated PostgreSQL/logs readiness checks; verify mocked HTTP/process/database cases cover API errors, existing rules, invalid IPs, startup failure, timeout, and readiness of both databases without connecting to live services.
- [x] 3.3 Add sequential PostgreSQL, logs, remote D1, and remote fulltext migrations followed by normal Worker deployment through `pnpm api --`; verify fake command execution proves order, selected credentials, remote D1 semantics, and stop-on-failure at each migration/publication stage.
- [x] 3.4 Add always-attempted cleanup of only the run-owned firewall rule and Tunnel PID; verify success, failure, cancellation, partial setup, pre-existing-rule preservation, and cleanup-error reporting without masking earlier failures or terminating unrelated processes.

## 4. Public output and private data lifecycle

- [x] 4.1 Capture bounded raw output/exceptions for every private-data stage and emit only predefined safe stage/error/exit-status messages; remove configuration-SHA echoes, raw tool streaming, environment dumps, and tracing, and register private values for defensive masking. Verify success/failure tests do not forward sensitive child stdout/stderr or injected workflow commands to logs, summaries, or annotations.
- [x] 4.2 Keep credentials in narrowly scoped process environments/stdin and private checkout/generated files in protected ephemeral storage; exclude all private data and raw release outputs from job outputs, caches, and artifacts, and add always-attempted file/helper cleanup. Verify synthetic storage/process tests cover success, failure, cancellation, credential scope, cache/artifact selections, and absence of plaintext credential files.
- [x] 4.3 Add confidentiality regressions with synthetic private repository/ref/path, host/resource identifiers, credential values, and derived/encoded sentinels; verify none appear on public output/persistence surfaces across checkout, validation, readiness, migration, publication, and cleanup failures, while safe source provenance and error categories remain useful.

## 5. Operator documentation and PR verification

- [x] 5.1 Update the English Cloudflare deployment guide and add an English CI guide with private manifest/native-config schemas, protected bootstrap selectors, Actions Secrets/legacy-name mappings, placeholder test Edge identity, event-ref environment restrictions, shared production-database risks, and retry/recovery instructions; verify examples contain no actual private values, all command examples exist in the current API manifest, and obsolete manual-deployment guidance links to its English replacement.
- [x] 5.2 Add focused offline deployment/privacy checks and the new workflow/tooling paths to API CI; verify YAML syntax and event/failure/privacy matrices without release secrets or private fetches in ordinary PR CI, and retain existing deployment configuration/path regression coverage.
- [x] 5.3 Run focused workflow/helper/privacy tests and existing API deployment-config regressions with synthetic configuration, plus `openspec validate --all --strict`; verify all pass and report any unavailable prerequisites without using real private configuration or executing remote deployment/migrations.
- [x] 5.4 Perform the Bugs, Security, and Compliance passes from `REVIEW.md`, resolve Important findings, and prepare the single PR targeting `dev` with `OpenSpec: merge-triggered-api-deploy`; verify the diff contains only this change, the linked tasks match implementation, public source/docs contain no private deployment values, and unrelated working-tree files are excluded before any push.
- [x] 5.5 Align private configuration documentation and merged-release loading with `api/dev.toml`, `api/beta.toml`, `api/prod.toml` and the default `api/releases.json`; verify synthetic three-environment fetches select the corresponding file at the immutable revision, retain protected path overrides, and keep real legacy configuration out of the public repository.

Local Bugs, Security, and Compliance review is complete; no Important findings remain. The single PR description targets `dev` and includes the required OpenSpec reference. Publication remains blocked by local GitHub network access and the connector's code-write permissions. Operator configuration-repository preparation also awaits repository access. See `verification.md` for evidence and limitations.
