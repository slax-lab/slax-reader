# Spec Delta

## MODIFIED Requirements

### Requirement: Bounded cost

The system SHALL stop spending on an article version above $1.00 across all attempts since the last explicit retry, SHALL stop spending on an article version above $2.00 in total across all retries, SHALL allow at most 20 automatic and 5 manual generate starts per user per UTC day, and SHALL defer new runs and send one alert per day when site-wide spend reaches $20 in a UTC day. An explicit owner retry of a `failed` version SHALL reset the version's run spend and attempt count, SHALL NOT reset its total spend, SHALL NOT count against the daily limits, and SHALL be allowed for `budget_exceeded`. A version that reaches the $2.00 total SHALL fail as `lifetime_budget_exceeded`. `too_long` and `lifetime_budget_exceeded` SHALL stay final.

#### Scenario: Daily automatic limit
- **WHEN** an owner triggers the 21st automatic start in one UTC day
- **THEN** the status is `limit_reached` and nothing starts

#### Scenario: Save-triggered start over the limit
- **WHEN** an owner saves a video after 20 automatic starts in the same UTC day
- **THEN** nothing starts and the version stays pending

#### Scenario: Site-wide budget
- **WHEN** site-wide spend for the day reaches the budget
- **THEN** new runs are deferred for the sweep and exactly one alert is sent that day

#### Scenario: Retry after the budget ran out
- **WHEN** a version is `failed` with `budget_exceeded` and its total spend is below $2.00
- **THEN** the status shows `can_retry`, the retry sets the version to pending with zero run spend and zero attempts, keeps the total spend, takes no daily start, and a run begins

#### Scenario: Retry after 5 manual starts
- **WHEN** the owner has used 5 manual starts today and requests a retry of a `failed` version
- **THEN** the retry starts the run

#### Scenario: Total spend reaches the cap
- **WHEN** the next model call would raise a version's total spend above $2.00
- **THEN** no call is made, the version is `failed` with `lifetime_budget_exceeded`, and the status shows neither `can_retry` nor `can_generate`

#### Scenario: Too long stays final
- **WHEN** a version is `skipped` or `failed` with `too_long`
- **THEN** the status shows neither `can_retry` nor `can_generate`
