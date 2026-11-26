# Spec Delta

## Purpose

Preserve bounded diagnostic evidence for backend failures whose cause is currently discarded, correlate those failures with Cloudflare's request record by Ray ID, and keep the bookmark failure events measuring saves that actually failed.

## ADDED Requirements

### Requirement: RSS refresh commit failures retain their cause

When an RSS refresh commit fails with an error other than the expected RSS domain error, the API SHALL emit the existing `RSS refresh commit failed` error entry with the feed identifier and the caught error's `name`, `message`, and `code`, and its `meta` value when the error carries one. The entry SHALL NOT include a Cloudflare Ray ID, because the failure is produced by the five-minute cron, which has no HTTP request. The entry MUST NOT include feed URLs or query strings, entry content, user content, tokens, credentials, IP addresses, or full payloads. Refresh results, retry timing, stored feed state, and the existing silent handling of the expected RSS domain error SHALL remain unchanged.

#### Scenario: Refresh commit fails with a database error
- **WHEN** the refresh commit transaction rejects with an error that carries a code or metadata
- **THEN** the existing error entry includes the feed identifier and the error's name, message, code, and metadata
- **AND** the entry does not include the feed URL, its query string, or a Ray ID

#### Scenario: Refresh commit fails with an error without code or metadata
- **WHEN** the refresh commit transaction rejects with an error that carries neither a code nor metadata
- **THEN** the existing error entry includes the feed identifier, name, and message, and omits the absent fields

#### Scenario: Expected RSS condition
- **WHEN** the refresh commit rejects with the expected RSS domain error
- **THEN** no `RSS refresh commit failed` entry is emitted and the existing handling is unchanged

### Requirement: Sync save failures retain their cause and Ray ID

When applying a sync save request fails, the API SHALL emit the existing `handleSyncSaveRequest failed` error entry with the user identifier, the change count, the request's Cloudflare Ray ID when the request carries one, and the caught error's `name`, `message`, and `code`, and its `meta` value when the error carries one. When the request contains exactly one change, the entry SHALL also include that change's `table` and `op`. The entry MUST NOT include change data, previous data, bookmark, tag or comment content, tokens, credentials, request bodies, IP addresses, or full payloads. The existing error response and retry behavior SHALL remain unchanged.

#### Scenario: Single-change batch fails
- **WHEN** a sync save request with one change fails
- **THEN** the error entry includes the user identifier, change count, the change's table and operation, the Ray ID, and the error's diagnostic fields
- **AND** the entry does not include the change's data or previous data

#### Scenario: Multi-change batch fails
- **WHEN** a sync save request with more than one change fails
- **THEN** the error entry includes the user identifier, change count, the Ray ID, and the error's diagnostic fields, and omits table and operation because the failing change is not identified

#### Scenario: The request has no Ray ID
- **WHEN** a sync save request fails without a Cloudflare Ray ID
- **THEN** the error entry omits the Ray ID field and keeps its other diagnostic fields

### Requirement: AI summary failures retain the provider failure fields

When bookmark summary generation fails, the API SHALL log one structured entry for that failed request containing the provider failure's `providerStatus`, `providerCode`, `reference`, `overloaded`, `timedOut`, a bounded `message`, and the request's Cloudflare Ray ID when present. Fields absent from the failure SHALL be omitted. The entry SHALL be emitted once per failed request, not once per streamed chunk or step. Existing log line texts, including `[aigc.vertex] chat stream failed`, SHALL remain unchanged. The entry MUST NOT include the provider API key, raw provider payloads, article content, tokens, or IP addresses.

#### Scenario: The provider returns a server failure
- **WHEN** summary generation fails with a provider HTTP status and reference id
- **THEN** one structured entry carries the provider status, code or reference, message, and the request Ray ID
- **AND** the existing provider-layer line text is unchanged

#### Scenario: The provider times out or is overloaded
- **WHEN** summary generation fails because the request timed out or the provider is overloaded
- **THEN** the entry includes `timedOut` or `overloaded` and omits absent fields

#### Scenario: The failure is not a provider failure
- **WHEN** summary generation fails with an error that carries no provider fields
- **THEN** the entry carries the bounded message and the Ray ID, and omits the provider fields

#### Scenario: The request has no Ray ID
- **WHEN** summary generation fails in an execution without an HTTP request
- **THEN** the entry omits the Ray ID and keeps its other fields

### Requirement: Browser clients can read the Ray ID header and cross-origin timings

API responses SHALL expose the Cloudflare Ray ID header to browser clients by naming `cf-ray` in `Access-Control-Expose-Headers`. API responses SHALL also send `Timing-Allow-Origin` for the Web origins `https://r.slax.com`, `https://r-beta.slax.com` and `https://r.slax.dev`, so browser Resource Timing can report DNS, TCP, TLS and time-to-first-byte for cross-origin API requests. The operator SHALL add the same `Timing-Allow-Origin` header on the PowerSync hostname through the existing Transform Rule. The CORS headers SHALL keep their existing allowed origin, allowed headers, allowed methods, and credentials behavior. Response bodies, status codes, and non-CORS headers SHALL remain unchanged, and media responses SHALL keep their existing exposed-header list.

#### Scenario: A browser calls a JSON API endpoint
- **WHEN** a Web client receives a JSON API response
- **THEN** `Access-Control-Expose-Headers` names `cf-ray`, `Timing-Allow-Origin` names the Web origins, and the response otherwise keeps its current CORS headers

#### Scenario: A browser sends a preflight request
- **WHEN** a CORS preflight reaches the API
- **THEN** the preflight response keeps its current status and headers, names `cf-ray` in `Access-Control-Expose-Headers`, and sends `Timing-Allow-Origin`

#### Scenario: A cross-origin request is measured
- **WHEN** the browser records Resource Timing for a request to the API or the PowerSync hostname
- **THEN** DNS, TCP, TLS and time-to-first-byte values are available instead of zero

#### Scenario: A media response is returned
- **WHEN** the API serves a cached or proxied media response
- **THEN** its existing exposed-header list is unchanged

### Requirement: Bookmark failure events distinguish persisted saves

The API SHALL emit `bookmark_save_failed` only when a save did not persist a bookmark. A failure of a step that runs after the bookmark persisted SHALL emit `bookmark_add_step_failed` with the step name in `error_class` and SHALL NOT emit `bookmark_save_failed`. A rejected blocked target SHALL emit `bookmark_save_failed` with `error_class=unsupported_target`. Other pre-persistence save failures SHALL keep `error_class=bookmark_add`, and rate-limited saves SHALL keep their existing event and class. The existing `bookmark_add_step` success and failure records, the step success-rate query, and the `source_bookmark_id` property on `bookmark_save_failed` SHALL remain unchanged.

#### Scenario: A post-save step fails
- **WHEN** content moderation, content validation, fetching, parsing or post-processing fails after the bookmark row exists
- **THEN** one `bookmark_add_step_failed` event carries the step name in `error_class`
- **AND** no `bookmark_save_failed` event is emitted for that step

#### Scenario: A blocked target is rejected
- **WHEN** a save is rejected because the target URL is blocked
- **THEN** `bookmark_save_failed` carries `error_class=unsupported_target`
- **AND** no bookmark was persisted

#### Scenario: The save itself fails
- **WHEN** adding the bookmark fails before a bookmark row exists
- **THEN** `bookmark_save_failed` carries `error_class=bookmark_add`

#### Scenario: A step fails in a background retry
- **WHEN** a post-save step fails in a background maintenance run with no originating client request
- **THEN** no server event is emitted, matching the existing context requirement

#### Scenario: A step succeeds
- **WHEN** a post-save step succeeds
- **THEN** the existing `bookmark_add_step` record is unchanged

### Requirement: Diagnostic fields remain bounded and payload-free

The diagnostic entries and events in this capability SHALL retain only the fields named by their requirement, plus the identifiers and change or step descriptors named there. They SHALL NOT serialize request or change payloads, user content, tokens, credentials, feed URLs, query strings, IP addresses, provider keys, or properties of the caught error other than the named diagnostic fields.

#### Scenario: Caught error carries a payload-like property
- **WHEN** the caught error also carries a request body, change data, or another payload-like property
- **THEN** the diagnostic entry omits that property

#### Scenario: A provider error carries its original response
- **WHEN** the provider error retains the raw provider response
- **THEN** the entry records only the named provider fields and omits the raw response
