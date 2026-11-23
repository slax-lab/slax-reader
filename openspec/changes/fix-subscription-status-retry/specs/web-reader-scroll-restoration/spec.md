# Spec Delta

## ADDED Requirements

### Requirement: A pending subscription decision is always backed by a current check

Whenever the signed-in account's identity state is invalidated or refreshed without changing the account, and the reader's subscription decision returns to pending, the Web application SHALL start a subscription check for the current identity unless one is already in flight for it, so that the decision resolves to active, inactive, or error. A failure SHALL present the existing explicit retry and SHALL NOT start another check by itself, including through the identity invalidation the failure causes. Checks started automatically because the identity changed while a check ran SHALL be bounded; when the bound is reached without a decision, the reader SHALL see the error state with the explicit retry. This SHALL NOT start checks for a signed-out reader and SHALL NOT let a result for an earlier identity decide the current one.

#### Scenario: Identity is refreshed for the same account during startup
- **WHEN** a signed-in reader's account identity is invalidated or its token is refreshed for the same account while the page is loading, after an earlier check started
- **THEN** a new subscription check runs for the current identity
- **AND** the reader leaves the checking state once it completes

#### Scenario: The fresh check fails
- **WHEN** the check started after such a refresh fails through a network or service error
- **THEN** the reader sees the existing error state with an explicit retry instead of staying in the checking state
- **AND** no further check starts until the reader retries

#### Scenario: The service keeps failing
- **WHEN** every profile read fails, and each failure invalidates the account identity
- **THEN** the page makes one check per identity change it did not cause and stops in the error state with an explicit retry

#### Scenario: Reader is signed out
- **WHEN** the identity state changes because the reader signed out
- **THEN** no subscription check starts
