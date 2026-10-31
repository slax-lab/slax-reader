# Spec Delta

## MODIFIED Requirements

### Requirement: Bounded cost

The system SHALL stop spending on an article version above $1.00 across all attempts since the last explicit retry, SHALL allow at most 20 automatic and 5 manual starts per user per UTC day, and SHALL defer new runs and send one alert per day when site-wide spend reaches $20 in a UTC day. An explicit owner retry of a `failed` version SHALL count as one manual start, SHALL reset the version's spent amount and attempt count, and SHALL be allowed for `budget_exceeded`. `too_long` SHALL stay final.

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
- **WHEN** a version is `failed` with `budget_exceeded` and the owner has manual starts left today
- **THEN** the status shows `can_retry`, the retry sets the version to pending with zero spent and zero attempts, takes one manual start, and a run begins

#### Scenario: Retry over the manual limit
- **WHEN** the owner has used 5 manual starts today and requests a retry
- **THEN** the status is `limit_reached` and the version stays `failed`

#### Scenario: Too long stays final
- **WHEN** a version is `skipped` or `failed` with `too_long`
- **THEN** the status shows neither `can_retry` nor `can_generate`
