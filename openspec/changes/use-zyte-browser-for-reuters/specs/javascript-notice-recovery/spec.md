# JavaScript notice recovery

## Purpose

Recover a regular public bookmark when its initial HTTP document only instructs readers to enable JavaScript.

## ADDED Requirements

### Requirement: Detect and retry a short JavaScript notice

For regular remote bookmark saves, the system SHALL recognize explicit English and Chinese JavaScript enablement instructions when the selected body has at most 120 characters after whitespace normalization. It SHALL retry an eligible raw capture once in Zyte browser mode before publishing a snapshot. A notice after browser rendering SHALL end the capture as failed. Diagnostic events SHALL contain the hostname, normalized text length and outcome.

#### Scenario: Browser rendering recovers the article

- **WHEN** the raw response is a short JavaScript notice and browser rendering returns an article
- **THEN** only the rendered article is published and the recovery is logged

#### Scenario: Browser rendering still returns the notice or fails

- **WHEN** the one browser request fails or returns another short JavaScript notice
- **THEN** the capture fails, the outcome is logged, and the workflow does not repeat the browser request

#### Scenario: The site already used Zyte browser mode

- **WHEN** the initial capture already attempted browser mode and produces a short JavaScript notice
- **THEN** the workflow records the outcome and makes no additional browser request

#### Scenario: A raw fallback supplies the notice after a browser error

- **WHEN** Zyte browser rendering fails and the raw fallback returns a JavaScript notice
- **THEN** the workflow records that the browser was unavailable and makes no second browser request

#### Scenario: The fallback reports a target error

- **WHEN** the fallback reports an unsuccessful target HTTP status
- **THEN** a matching notice fails without a browser retry and a readable article remains eligible for regular publication

#### Scenario: A recovered notice reaches bookmark telemetry

- **WHEN** the browser retry succeeds
- **THEN** fetch and parse success are visible in bookmark step telemetry, and the initial notice does not emit a bookmark save failure

#### Scenario: Ordinary content

- **WHEN** the body exceeds the limit, lacks an explicit enablement instruction, or includes substantive editorial media
- **THEN** normal bookmark processing continues without an extra request
