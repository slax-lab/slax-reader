# Proposal

## Why

The Web snapshot overview reader interprets HTTP 401 JSON as overview progress and rejects outside the panel's error handler, leaving its loading state active. Public snapshot visitors can trigger the same request even when the overview is hidden.

## What Changes

- Start Web snapshot overview requests only when the panel supports overview for the current viewer and bookmark.
- Apply the existing Web session-rejection policy when an overview request returns HTTP 401, before reading any stream data.
- Settle the panel's loading state when a stream read or frame fails. Continue processing successful overview, key-takeaway, and completion frames.

## Capabilities

### New Capabilities

- `web-snapshot-overview-stream` covers eligibility, HTTP rejection, and completion for the Web snapshot overview.

### Modified Capabilities

None.

## Impact

Web request handling and the snapshot AI panel. The change uses the current Web login flow and API response contracts.

## Review

The change requester approved the three-step fix in conversation on 2026-11-24 and requested verification of anonymous visitor, HTTP 401, and HTTP 200 stream behavior.
