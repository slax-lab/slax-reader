# Design

## Context

Both webhook admission and the payment service currently use the platform marker as an ownership gate. Removing only the first check leaves the consumer rejecting the same invoices. Existing customer bindings and invoice grant keys provide ownership and deduplication independently.

## Goals / Non-Goals

Remove the platform marker gate consistently. Use live Stripe mode consistently without a global environment switch. Keep account, collection/owner, user-id, customer, and invoice-line validation, and reject test-mode events. Bulk event replay and extra goodwill compensation are outside the code change.

## Decisions

- Webhook admission rejects collection/owner metadata without inspecting platform. Downstream operations continue validating the user/customer identity.
- Live mode is a runtime invariant for deployed Stripe callbacks, consumers, cancellation, and reward credits. Missing Worker configuration cannot park legitimate live events. Persisted test-mode operations remain excluded from recovery.
- Replace the payment service's platform predicate with an explicit personal-payment predicate used across existing payment paths. Keeping the downstream platform gate would reproduce the incident after successful callback ingestion.
- Recovery SQL uses real invoice grant keys and restores the period ledger together with the cached expiry in one transaction. Direct expiry-only updates would be overwritten by later period projection and would not prevent duplicate replay.
- Keep customer-specific SQL and operator-supplied evidence outside Git. It is a local deliverable, not an automatic migration.

## Risks / Trade-offs

Missing platform metadata no longer blocks legitimate legacy subscriptions. Events for another product still require a valid local user/customer pair and cannot carry collection/owner metadata. Test-mode webhooks are rejected and persisted test-mode external operations are parked. Local verification uses synthetic signed live-mode payloads with mocked Stripe clients; it does not issue real charges.

## Migration Plan

Deploy the API code through the normal branch workflow. The owner runs the verified compensation SQL separately. Reverting the admission changes restores the former gates but does not undo operator compensation.
