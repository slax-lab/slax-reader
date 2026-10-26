# Proposal

## Why

Successful Pages releases can leave stale Cloudflare edge cache entries. Production also needs to use the existing `main` GitHub Environment, not the nonexistent `prod` Environment.

## What Changes

- Purge only the released Web hostname after Pages confirms deployment success.
- Reuse environment Secrets `CLOUDFLARE_API_TOKEN` and `CF_ZONE_ID`; fail on purge errors without printing credentials or raw responses.
- Select GitHub Environments `dev`, `beta`, and `main` directly from the target branch.

## Capabilities

### New Capabilities

- `web-release-cache-purge`: Environment-isolated post-deployment edge cache purging.

### Modified Capabilities

None. This follows the merged, unarchived `web-pages-deployment` change and supersedes its `main` to `prod` Environment mapping without modifying its delta files.

## Impact

Changes the existing Web release helper, workflow, regression tests, and operator documentation. No new dependencies, browser cache changes, API deployment changes, or cloud provisioning. The operator confirmed Cache Purge permissions and authorized direct implementation and a pull request.
