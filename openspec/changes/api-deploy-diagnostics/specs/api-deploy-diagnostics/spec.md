# Spec Delta

## Purpose

Help operators distinguish API release failures and verify D1 migration paths while keeping private deployment information out of public CI output.

## ADDED Requirements

### Requirement: D1 migration paths are verified before remote access

The release SHALL check that the effective Core configuration resolves DB to the checked-out primary D1 SQL directory and DB_FULLTEXT to its fulltext directory, with SQL migrations available in both. A missing, empty or incorrect directory MUST stop the release before opening remote database access and report a fixed failure message without configuration values.

#### Scenario: Both configured directories resolve correctly
- **WHEN** both bindings resolve to their checked-out SQL directories with migrations available
- **THEN** CI reports successful path verification and continues offline generation and build

#### Scenario: A migration path is incorrect or unavailable
- **WHEN** either binding has an incorrect, missing or empty migration directory
- **THEN** CI reports path verification failure and performs no remote database access or publication

### Requirement: Operational diagnostics remain confidential

Firewall HTTP failures SHALL report the fixed request stage, HTTP status and curl exit status. Migration and publication failures SHALL report the failing command and exit status, plus a fixed recognized error category and numeric Cloudflare error codes when present. Raw tool output, private configuration, endpoints, identifiers and credentials MUST remain withheld and be removed during existing cleanup. Any failed migration MUST stop subsequent migrations and Worker publication.

#### Scenario: A firewall HTTP request is rejected
- **WHEN** Cloudflare rejects a firewall request
- **THEN** CI reports its stage and numeric statuses without the URL, authorization header or response body

#### Scenario: A migration fails with recognizable diagnostics
- **WHEN** a migration fails with a recognized path, authentication or SQL error, or a numeric Cloudflare error code
- **THEN** CI reports only the safe category and codes alongside the command's exit status, and stops subsequent release commands

#### Scenario: A migration error is unrecognized
- **WHEN** a failed migration has no recognized error category or numeric Cloudflare code
- **THEN** CI reports the failing command and exit status while continuing to withhold the raw diagnostic
