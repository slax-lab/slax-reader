# Spec Delta

## Purpose

Keep Web snapshot overview requests aligned with viewer eligibility and ensure that failures settle the overview panel.

## ADDED Requirements

### Requirement: Web overview requests follow panel eligibility

The Web snapshot AI panel SHALL start overview requests only when overview is supported for the current viewer and bookmark. An available snapshot outline SHALL remain usable independently of overview eligibility.

#### Scenario: Anonymous visitor reads a public snapshot with an outline

- **WHEN** the visitor opens the AI panel of a publicly readable snapshot with an existing outline
- **THEN** the panel displays the outline and sends no overview request

### Requirement: Rejected and completed overview streams settle the panel

A Web overview request receiving HTTP 401 SHALL end before any response body is processed as progress, clear the rejected Web session, and navigate to login. Other HTTP failures, read failures, and invalid overview frames SHALL leave the loading state and use the existing overview failure behavior. Successful overview streams SHALL continue to render overview text and key takeaways and leave the loading state on completion.

#### Scenario: An authenticated overview request is rejected

- **WHEN** the overview endpoint returns HTTP 401 with a JSON error body
- **THEN** the Web client clears the session, navigates to login, and produces no unhandled rejection or automatic overview retry

#### Scenario: An eligible overview stream completes

- **WHEN** the endpoint returns HTTP 200 and streams overview, key takeaways, and completion data
- **THEN** the panel displays the overview and key takeaways and finishes loading

#### Scenario: Overview streaming fails after request setup

- **WHEN** reading the response fails or a frame contains an invalid overview payload
- **THEN** the panel exits loading and produces no unhandled rejection
- **AND** the existing retry control is available if the panel has no overview text
