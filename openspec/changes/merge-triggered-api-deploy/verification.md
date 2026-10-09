# Verification

OpenSpec: merge-triggered-api-deploy.

## Final implementation

Deployment is contained in one existing api-deploy.yml workflow with inline steps and existing root API commands. The extra merge-entry workflow, release orchestrator/policy/test modules, release:check command and settings JSON are removed. Configuration consists only of the existing private api/dev.toml, api/beta.toml and api/prod.toml; the extra release manifest is removed and the three TOML contents are unchanged. Private PR scanning calls pinned Gitleaks directly, with inline credential-file checks and no custom scanner scripts or test framework.

## Offline results

- Both workflow YAML files parsed; inline shell syntax and Python compilation passed. Static contracts cover merged-only triggering, merge-SHA checkout, test/shared-production locks, no release caches/artifacts, read-only PR scanning and always-running cleanup.
- Temporary synthetic tests passed for all three selected-file fetches, private status, immutable snapshot pinning, account/runtime mode, invalid file paths, executable/credential data, API failures and suppression of private exceptions.
- Inline URL tests passed for matching ports, default PostgreSQL port and malformed/mismatched inputs. Inline database readiness tests passed for success, timeout and dead Tunnel.
- Command substitutes verified validation and migration/deployment order, stop-on-failure at every command and captured private stdout/stderr.
- Mocked firewall tests passed for account mismatch before mutation, existing-rule preservation, run-owned cleanup and recovery of a lost creation response.
- Synthetic Git histories verified forbidden credential paths and symlinks still fail after removal in a later commit. Gitleaks rule TOML/regex checks and synthetic scanner success/finding/error substitutions passed without forwarding raw diagnostics.
- Existing API deployment configuration tests: 12 passed. OpenSpec strict validation: 18 items passed, no failures. TypeScript passed earlier in this task; no new API TypeScript was introduced by the final workflow simplification. Whitespace checks passed.
- API path selection: 20 synthetic path cases passed. Both revision checks use the same paths as the native workflow filter; 50 real-Git revision/error cases and six depth-one clone cases passed, including previously unavailable tip objects and deleted API source. Later frontend/documentation commits preserve eligibility; newer API/contracts/root dependency changes supersede a run; fetch/comparison errors stop it. Merged-only gates and environment selection remain unchanged. Web and Extension release scopes are documented for later implementation; no placeholder release jobs were added.

All fixtures and command substitutes were temporary and used synthetic values. No actual credential files, business databases, cloud resource mutations, remote migrations or Worker deployments were accessed. The three native configuration files remain in an independent checkout; no real values were added to public source.

## Review and external limits

Bugs: checked merge/environment selection, fixed selected paths, snapshot resolution, command ordering, shell failure propagation, stale-source skips, readiness bounds and cleanup ownership. Corrected conditional-subshell failure handling so a failed zone/account check cannot continue into rule creation. No Important findings remain.

Security: checked authenticated private fetch, redirect rejection, declarative data boundaries, account consistency, credential scoping, output capture, temporary storage and scanner failure behavior. Private agent rules remain strict. Scanner workflow/policy changes need human review and the exact Secret scan status must be required by branch protection. No Important implementation findings remain.

Compliance: the final implementation follows the user's explicit request for the previous pipeline in one workflow, three private native files and Actions Secrets, without an additional release/scanner framework. It matches the revised proposal/design/spec/tasks for merge-triggered-api-deploy. Promotion/sync-back merges remain human-owned. No Important findings remain.

Actual Gitleaks execution was unavailable locally because its HTTPS download failed GitHub DNS resolution; the pinned official version/checksum were verified previously. Local Git push/PR creation remains blocked by GitHub network resolution and connector write permissions. Remote private repository visibility and branch protection are unverified. Offline results do not claim a live GitHub or cloud acceptance test. Prepare reviewed private configuration, environment-scoped Secrets and default-branch Environment policies before the first eligible merge.
