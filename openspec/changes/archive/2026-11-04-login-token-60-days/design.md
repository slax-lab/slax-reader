# Design

## Context

See `proposal.md`. `Auth.sign` already uses `JWT_EXPIRES` in seconds for both login and renewal; `Auth.verify` enforces the signed expiration. Releases load a private environment TOML rather than the public template.

## Goals / Non-Goals

Use the existing configuration boundary for the approved 60-day lifetime. Application source, client scheduling, cookie handling and PowerSync issuance remain outside this change.

## Decisions

Change only the template value and document the private-configuration rollout. Keep the configured lifetime operator-owned, rather than overriding it in application code or adding a new credential mechanism. The user explicitly approved this smaller approach on 2026-11-04.

## Risks / Trade-offs

- A template-only merge does not update live configuration: document the required private `[vars].JWT_EXPIRES = "5184000"` update before deployment.
- Previously signed expirations are immutable: existing tokens keep their original expiration, and rollback does not revoke newly issued 60-day tokens.

## Migration Plan

Operators update the intended private environment configuration and deploy through the existing reviewed source-release flow. Existing local installations update their own configured value; newly initialized configurations receive the new template value. Revert the value to `2592000` to restore 30-day issuance for subsequent tokens. No database migration or client release is required.
