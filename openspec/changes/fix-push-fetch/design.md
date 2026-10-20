# Design

## Context

See `proposal.md` for the reproduced Workers failure. All three sender functions use the same unsupported redirect mode. Destination validation already limits URLs to HTTPS without embedded credentials or fragments. Node's fetch mock currently accepts the unsupported option and therefore misses the production failure.

## Goals / Non-Goals

**Goals:** Restore outbound requests while retaining the policy that notification payloads never follow a redirect.

**Non-Goals:** Change provider message schemas, environment gating, workflow retries, database configuration, moderation, or provider-level business-code handling.

## Decisions

Use one internal JSON POST helper with `redirect: 'manual'` and reject non-2xx responses after cancelling their bodies. Keeping `error` reproduces the incident; using `follow` could forward private notification content to a different destination. A shared helper applies the same behavior to all existing senders without changing their payload builders or DI registrations.

Report only the HTTP status on response rejection. Do not include the destination, Location header, provider body, or message in the new error. Preserve existing handling of successful provider responses.

Extend the channel tests for successful requests, redirects, and HTTP errors. Also bundle the actual client into an isolated local workerd fixture with intercepted outbound requests: this exercises the runtime constraint that Node mocks do not enforce, without live webhook traffic or deployment configuration.

## Risks / Trade-offs

- HTTP 200 provider business failures remain governed by the existing behavior; validating provider-specific error envelopes is outside this transport fix.
- Callers that catch notification failures still control their existing workflow outcomes. This change does not introduce retries or duplicate sends.

## Migration Plan

The PR follows the normal API release flow after merge. No schema or configuration migration is required. Reverting the source commit restores the previous implementation; this task does not publish Workers.
