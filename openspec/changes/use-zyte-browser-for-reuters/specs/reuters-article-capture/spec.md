# Reuters article capture

## Purpose

Retrieve the rendered body of a public Reuters article when a reader saves its URL, and surface a failed capture when the source provides only an access notice.

## ADDED Requirements

### Requirement: Request rendered Reuters articles from Zyte

For a regular URL save on `www.reuters.com` or `reuters.com`, the system SHALL request the submitted URL from Zyte in JavaScript-enabled browser HTML mode. The existing fallback provider SHALL retain its ordinary request mode for these hosts.

#### Scenario: Browser returns a readable article

- **WHEN** Zyte returns a rendered Reuters article
- **THEN** Slax extracts and saves the returned article body through its regular bookmark path

#### Scenario: Primary provider fails

- **WHEN** Zyte fails to fetch a Reuters article
- **THEN** the regular fallback provider gets the same URL using its existing HTTP request mode

#### Scenario: URL contains a Reuters URL on an unrelated host

- **WHEN** a reader saves an ordinary unconfigured site whose query string contains a Reuters article URL
- **THEN** Zyte receives the site's usual raw HTTP request

### Requirement: Recognize the observed Reuters access notice

When the selected Reuters content contains only the site's “Please enable JS and disable any ad blocker” notice, the system SHALL report a failed capture before writing a successful snapshot or triggering content post-processing.

#### Scenario: Successful transport returns only the notice

- **WHEN** a Reuters capture returns HTTP 200 and the selected body consists only of the access notice
- **THEN** the capture fails without publishing the notice as an article

#### Scenario: Valid reporting quotes the notice

- **WHEN** a Reuters article includes the notice alongside substantive reporting
- **THEN** the article remains eligible for a successful capture
