## ADDED Requirements

### Requirement: Subscription lifecycle telemetry is persisted in user_logs

The API SHALL persist subscription lifecycle telemetry in `user_logs`, using the subscription action as the event name: `auto_renew_off` when a subscription's auto-renew is turned off, `cancel` when the subscription is deleted, and `refund` when a refund is applied. The logs `event_kind` enum SHALL accept those three event names.

Recording SHALL remain best-effort. A telemetry write failure SHALL NOT change the payment reconciliation outcome or block the surrounding payment job, and it SHALL remain visible as an error log.

#### Scenario: Auto-renew is turned off

- **WHEN** a subscription state write changes auto-renew from on to off for a bound user
- **THEN** one `auto_renew_off` row is stored in `user_logs` with the successful cancellation payload

#### Scenario: Subscription is deleted

- **WHEN** a subscription state write deletes the subscription for a bound user
- **THEN** one `cancel` row is stored in `user_logs` with the successful cancellation payload

#### Scenario: Refund is applied

- **WHEN** a refund is applied to a bound user's payment grant
- **THEN** one `refund` row is stored in `user_logs` with the successful refund payload

#### Scenario: Logs storage is unavailable

- **WHEN** the logs database rejects or cannot accept a telemetry write
- **THEN** the payment job still completes and the failure is logged rather than raised to the payment flow
