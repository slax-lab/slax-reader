# Proposal

## Why

Legacy Stripe subscriptions have a valid user/customer binding but no `metadata.platform` marker. Requiring `platform=reader` silently parks their renewal events before the entitlement inbox, leaving paying users without Pro.

## What Changes

- Remove `metadata.platform` as an admission requirement for Stripe callbacks and payment processing.
- Remove the global Stripe mode configuration switch. Payment callbacks, queue consumers, cancellation, and reward credits use live Stripe mode without a per-Worker flag. Continue rejecting collection/owner payments, connected-account and test-mode events, and preserve signature, user-id, customer-binding, invoice-shape, and idempotency checks.
- Produce a separate, operator-executed incident recovery SQL artifact using confirmed invoice identities. Do not execute production compensation or deploy Workers.

## Capabilities

### New Capabilities
- `stripe-payment-ownership`: Stripe payment ownership uses user and customer binding without requiring a platform marker.

### Modified Capabilities
None.

## Impact

API subscription callback and payment services, focused regression tests, and incident recovery instructions. The obsolete Worker environment binding and deployment instructions are removed. No API contract, database schema, Web/Extension/Mobile/CLI package output, or dependency change.

## Conversation Review

On 2026-10-28, after reviewing the production evidence and the proposed removal of the Reader marker gate, the owner explicitly instructed: remove the Reader event restriction and deliver compensation SQL. This records the approved narrow scope; production execution remains with the owner.

The owner subsequently explicitly instructed removal of the global Stripe mode flag, with deployed payment processing always using live mode. This extends the approved scope to all runtime consumers and operator configuration documentation.
