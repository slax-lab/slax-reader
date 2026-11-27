# Spec Delta

## Purpose

Keep historical signed image URLs readable by clients that request the saved URL directly, without rewriting saved articles or weakening access checks.

## ADDED Requirements

### Requirement: Serve one verified extra layer in the original response

After the outer request passes its existing signature, mode, incoming Referer and request checks, the image endpoint SHALL serve a supported inner signed request as if requested directly, without asking the client to follow a redirect to the inner proxy. The inner URL MUST match the configured origin and path, carry an independently valid signature over its source, Referer and matching mode, and identify a permitted public source other than the configured proxy.

#### Scenario: A stored bookmark image is wrapped twice
- **WHEN** an admitted reader requests an ordinary double-wrapped URL and the inner request would serve a saved or upstream image
- **THEN** the original request returns the same image bytes and MIME type without fetching the inner endpoint over HTTP
- **AND** upstream source-site Referer handling uses the inner signed Referer rather than the outer one

#### Scenario: Both layers use RSS mode
- **WHEN** a valid RSS request wraps one valid RSS request
- **THEN** the same image-only, byte-limit, range-rejection and no-source-redirect rules as a direct RSS request apply, including to cached content

#### Scenario: Outer request fails admission
- **WHEN** the outer signature, mode or incoming Referer is invalid, including when inner image bytes have already been cached
- **THEN** the endpoint rejects the request as before and does not serve the inner image

#### Scenario: Nested shape is not supported
- **WHEN** the inner URL has an invalid signature, malformed fields or encoding, a different origin, path or mode, or itself targets the configured proxy
- **THEN** the endpoint retains the existing handling of the outer source without substituting the innermost destination or granting new access

#### Scenario: Source is not nested
- **WHEN** the request contains an ordinary single-wrapped image or media source
- **THEN** the existing status, headers, range handling and response behavior remain unchanged
