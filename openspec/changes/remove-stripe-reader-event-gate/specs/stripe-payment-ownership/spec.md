# Spec Delta

## Purpose

Allow Stripe payments for locally bound users to retain their entitlements across legacy subscription metadata versions while preserving ownership checks.

## ADDED Requirements

### Requirement: Platform metadata does not gate Stripe payment processing
The system SHALL accept otherwise valid Stripe payment events without requiring `metadata.platform` to equal `reader`. The same rule SHALL apply to subscription state, one-time payments, invoice grants, refunds, and cancellation ownership checks.

#### Scenario: Legacy renewal has no platform marker
- **WHEN** a signed renewal identifies a valid user and the user's bound Stripe customer, without a platform marker
- **THEN** it enters the payment inbox and is eligible for the existing idempotent entitlement grant

#### Scenario: Platform marker has another value
- **WHEN** an otherwise valid bound payment carries a platform marker other than `reader`
- **THEN** the marker alone does not cause the event to be rejected

### Requirement: Payment ownership checks remain effective
The system MUST continue rejecting connected-account events and collection/owner payments, and MUST continue requiring a valid user and matching stored Stripe customer for entitlement changes.

#### Scenario: Collection metadata is present
- **WHEN** a payment carries a nonempty collection or owner identifier
- **THEN** it does not grant Reader subscription entitlement

#### Scenario: User or customer binding is invalid
- **WHEN** a platform-less invoice lacks a valid user identifier or its customer differs from the stored binding
- **THEN** no entitlement is granted

#### Scenario: Event has already granted entitlement
- **WHEN** a valid platform-less invoice is delivered again
- **THEN** its invoice grant key prevents duplicate entitlement

### Requirement: Stripe modes do not require a global deployment switch
The system SHALL process valid signed test-mode and live-mode Stripe callbacks and queued events without requiring a global deployment mode environment variable. Cancellation and external operation recovery SHALL support either mode through the configured Stripe client. Event and operation modes SHALL remain part of their existing ledger namespaces for deduplication.

#### Scenario: Worker has no Stripe mode environment binding
- **WHEN** a valid signed test or live Stripe invoice reaches the callback and queue consumer with no mode environment binding
- **THEN** it is eligible for the existing entitlement grant under its event mode and is not parked because configuration is missing

#### Scenario: Reward creates a Stripe credit
- **WHEN** a bound Stripe subscriber claims an eligible reward without a mode environment binding
- **THEN** the durable credit and its execution use the same operation key in the configured Stripe client's mode namespace

#### Scenario: Test or live operation reaches recovery
- **WHEN** a persisted Stripe cancellation or credit operation reaches payment recovery
- **THEN** recovery executes it through the configured Stripe client without rejecting its mode
