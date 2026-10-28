# Spec Delta

## Purpose

Allow Stripe payments for locally bound users to retain their entitlements across legacy subscription metadata versions while preserving ownership checks.

## ADDED Requirements

### Requirement: Platform metadata does not gate Stripe payment processing
The system SHALL accept otherwise valid Stripe payment events without requiring `metadata.platform` to equal `reader`. The same rule SHALL apply to subscription state, one-time payments, invoice grants, refunds, and cancellation ownership checks.

#### Scenario: Legacy renewal has no platform marker
- **WHEN** a signed live-mode renewal identifies a valid user and the user's bound Stripe customer, without a platform marker
- **THEN** it enters the payment inbox and is eligible for the existing idempotent entitlement grant

#### Scenario: Platform marker has another value
- **WHEN** an otherwise valid bound payment carries a platform marker other than `reader`
- **THEN** the marker alone does not cause the event to be rejected

### Requirement: Payment ownership checks remain effective
The system MUST continue rejecting connected-account or test-mode events and collection/owner payments, and MUST continue requiring a valid user and matching stored Stripe customer for entitlement changes.

#### Scenario: Collection metadata is present
- **WHEN** a payment carries a nonempty collection or owner identifier
- **THEN** it does not grant Reader subscription entitlement

#### Scenario: User or customer binding is invalid
- **WHEN** a platform-less invoice lacks a valid user identifier or its customer differs from the stored binding
- **THEN** no entitlement is granted

#### Scenario: Event has already granted entitlement
- **WHEN** a valid platform-less invoice is delivered again
- **THEN** its invoice grant key prevents duplicate entitlement

### Requirement: Deployed Stripe processing always uses live mode
The system SHALL process live Stripe callbacks, queued events, cancellation, and reward credits without requiring a global deployment mode environment variable. The system MUST reject test-mode callbacks and queued events and MUST NOT recover persisted test-mode Stripe external operations.

#### Scenario: Edge has no Stripe mode environment binding
- **WHEN** a valid live Stripe invoice reaches the callback and queue consumer with no mode environment binding
- **THEN** it is eligible for the existing entitlement grant and is not parked because configuration is missing

#### Scenario: Reward creates a Stripe credit
- **WHEN** a bound Stripe subscriber claims an eligible reward without a mode environment binding
- **THEN** the durable credit and its execution use the live Stripe operation key

#### Scenario: Test-mode event or operation reaches a deployed worker
- **WHEN** a test-mode Stripe event or persisted external operation reaches callback ingestion or payment recovery
- **THEN** it does not grant entitlement or execute an external Stripe operation
