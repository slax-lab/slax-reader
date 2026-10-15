# Proposal

## Why

API deployment currently selects the GitHub Environment `prod` for a merge into `main`, so production deployment configuration and the GitHub deployment display use a different name from the release branch. The human clarified that only this GitHub Environment selection and display should change.

## What Changes

- Select GitHub Environments `dev`, `beta`, and `main` directly from the merged target branch in API deployment. Web already uses this mapping and requires no workflow edit.
- Update operator documentation to distinguish GitHub Environment selection from API configuration selection.
- Preserve `DEPLOY_ENVIRONMENT`, `api/prod.toml`, `RUN_ENV`, `RUN_TYPE`, application code, cloud resources, deployment gates, and concurrency exactly as they are.
- Verify all three branch selections and that the parsed workflow changes only its job environment field. Do not add application code or test files for this small configuration fix.

## Capabilities

### New Capabilities

- `github-deployment-environment-selection`: GitHub deployment environment names follow release branches while internal deployment configuration and runtime identities retain their existing contracts.

### Modified Capabilities

None of the main specs changes. `release-branching` already defines main as production. This narrowly supersedes earlier GitHub Environment naming in merged deployment proposals; it does not supersede their runtime or configuration-file contracts. Open PR #234 proposes mapping Web back to prod and conflicts with the clarified direction; it must not be merged unchanged.

## Impact

- One field in `.github/workflows/api-deploy.yml` and English API deployment documentation.
- The existing `main` GitHub Environment needs its own Actions settings before deployment; metadata-only inspection found no Variables or Secrets there. This task does not read or copy secret values, edit GitHub settings, or initiate a deployment.
- No application, deployment-script, template, private-configuration, dependency, or database changes.
