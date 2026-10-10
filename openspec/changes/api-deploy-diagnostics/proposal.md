# Proposal

## Why

API releases currently hide the cause of firewall and migration failures. Operators also cannot confirm whether generated D1 configuration resolves to the checked-out SQL directories before database access begins.

## What Changes

- Check the effective Core configuration's DB and DB_FULLTEXT migration directories and SQL files before remote access.
- Report fixed firewall stages, HTTP status and curl exit status; report migration exit status, recognized error categories and numeric Cloudflare error codes.
- Keep configuration values, endpoints, identities and raw diagnostics in temporary protected files, and stop publication after a failed migration.
- Document the generated configuration location and Wrangler path resolution.

## Capabilities

### New Capabilities

- `api-deploy-diagnostics`: Offline D1 path verification and confidential operational failure reporting for API releases.

### Modified Capabilities

None.

## Impact

The existing API deployment workflow and its operator guide. No new deployment scripts, dependencies, configuration fields or Secrets are required. The existing merge gate, environment mapping and migration sequence remain authoritative. The checks diagnose failures; they do not establish the cause of the previously observed remote D1 failure.
