## ADDED Requirements

### Requirement: Apple environment admission follows the installation
The system SHALL admit a verified Apple transaction, server notification or queued Apple event only when its bundle identifier matches the configured App Store bundle identifier and its environment is allowed for the installation. The production installation SHALL allow Production and Sandbox. Every other installation SHALL allow only Sandbox. Any other environment value SHALL be rejected before entitlement, ledger, notice or telemetry writes. Admission SHALL NOT bypass the signature, product, transaction type, account token, order or active-period checks.

#### Scenario: TestFlight purchase is verified on production
- **WHEN** a TestFlight build submits a verified, active Sandbox transaction for the signed-in account to the production API
- **THEN** verification succeeds and access is granted

#### Scenario: Production notification arrives on production
- **WHEN** a verified Production App Store Server Notification reaches the production API
- **THEN** it is processed under the existing rules

#### Scenario: Sandbox notification arrives on production
- **WHEN** a verified Sandbox App Store Server Notification for an allowed product reaches the production API
- **THEN** it is processed under the existing rules

#### Scenario: Production transaction reaches a non-production installation
- **WHEN** a development or beta installation receives a verified Production transaction
- **THEN** it is rejected without side effects

#### Scenario: Unknown environment is presented
- **WHEN** a verified transaction or notification carries an environment other than Production or Sandbox
- **THEN** it is rejected without side effects

### Requirement: Apple ledger namespaces stay separated by environment
The system SHALL keep the transaction environment in every Apple grant key, grant scope, processed-transaction key, renewal-state key and notification job key. Sandbox and Production transactions SHALL NOT deduplicate against or extend coverage for each other.

#### Scenario: Sandbox grant is written on production
- **WHEN** the production API grants access for a Sandbox transaction
- **THEN** the grant key and scope carry the Sandbox environment
