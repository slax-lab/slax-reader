# Spec Delta

## Purpose

Make client-observed PowerSync phase timings and outcomes queryable in the Reader event lake, using one phase vocabulary across Web and Mobile and join keys to the matching error record.

## ADDED Requirements

### Requirement: Record PowerSync phase outcomes in the Reader event lake

Authenticated Web and Mobile app sessions SHALL publish `powersync_phase` observations, and connection-loss observations as `powersync_connection_lost`, to the existing first-party Reader event lake at `/events`. Each `powersync_phase` observation SHALL identify one phase from the single vocabulary `token`, `connect`, `stream`, `upload`, an outcome, and the relevant context. Durations SHALL be nonnegative elapsed milliseconds and SHALL be omitted when either timing boundary is unavailable. The prior proposal's phase names SHALL map as `credentials` to `token`, `download` to `stream`, and `submit` and `acknowledge` to `upload` with a `step` property that keeps them distinct. The event envelope SHALL retain the existing authenticated user, device, timestamp, platform and client-version attribution. Observations MUST NOT include credentials, tokens, credentialed endpoints, article content, mutation payloads, or stack traces.

#### Scenario: Credentials are fetched or reused
- **WHEN** the client acquires PowerSync credentials for an active account
- **THEN** it records a `token` outcome and whether credentials came from cache or the API
- **AND** callers sharing one in-flight acquisition produce one observation

#### Scenario: A connection succeeds or is re-established
- **WHEN** an initial or subsequent PowerSync connection attempt completes
- **THEN** it records a `connect` outcome with the elapsed time when both boundaries are available
- **AND** the observation distinguishes an initial attempt, a reconnection, and a stream already connected when observation began

#### Scenario: A download cycle ends
- **WHEN** an observed download cycle applies a successful sync locally
- **THEN** it records a `stream` outcome with the download-through-local-application elapsed time
- **AND** a retained sync timestamp alone does not produce a success observation

#### Scenario: Local changes are submitted and acknowledged
- **WHEN** a non-empty batch is submitted through the Slax sync API and its local batch is completed
- **THEN** the submission and acknowledgement are recorded as `upload` outcomes with their `step` values and elapsed times
- **AND** a rejected submission leaves the mutations queued under the existing retry behavior

#### Scenario: A connection is lost
- **WHEN** an observed active connection becomes disconnected for an unknown reason
- **THEN** a `powersync_connection_lost` observation carries the bounded reason when known
- **AND** intentional suspension and known offline transitions are distinguishable from unexplained loss

### Requirement: Failure observations join to error records without double counting

When an observed phase fails, the Reader event lake SHALL receive one phase outcome that carries the same fingerprint and Ray ID as the corresponding record in `client_errors.errors` when those are available. The error record in `client_errors.errors` SHALL be counted once by its single counting source, and the Reader event lake SHALL NOT receive a second error or stack record for that failure. A failure SHALL therefore appear as one row in each table, joinable by fingerprint and Ray ID, and neither table SHALL double-count it.

#### Scenario: An upload failure is observed
- **WHEN** an upload is rejected and the client records a `powersync` error
- **THEN** one `client_errors.errors` row and one `powersync_phase` outcome for `upload` carry the same fingerprint
- **AND** both carry the same Ray ID when the response exposed one

#### Scenario: A stream failure exposes no Ray ID
- **WHEN** the SDK reports a stream failure without exposing the response
- **THEN** the phase outcome carries the fingerprint and omits the Ray ID
- **AND** the absence is not evidence that the request failed to reach Cloudflare

#### Scenario: The failure is counted in the error table
- **WHEN** a failed phase produces an error record
- **THEN** the Reader event lake contains one phase outcome for that phase edge and no error or stack record
- **AND** `client_errors.errors` contains one row for that failure

#### Scenario: A phase succeeds
- **WHEN** a phase completes successfully
- **THEN** the Reader event lake records its outcome and no `client_errors.errors` row is created

### Requirement: Observations are attributable and best effort

Sync telemetry SHALL use a fixed property allowlist and bounded values. It SHALL preserve authenticated account attribution across asynchronous operations, discard stale observations from a retired account or environment, and suppress duplicate observations for unchanged status or a retained error. Delivery SHALL be best effort and SHALL never delay or alter synchronization, session handling, startup, or the error collector.

#### Scenario: A status error persists across updates
- **WHEN** PowerSync publishes the same active error over multiple status updates
- **THEN** it is reported once within the observed failure episode
- **AND** a new failure after recovery can be reported again

#### Scenario: A previous account's operation finishes late
- **WHEN** an observation finishes after logout, account change, or environment change
- **THEN** it is never emitted under the next account or environment

#### Scenario: The event sender is unavailable
- **WHEN** the first-party sender is offline or rejects an event
- **THEN** connection, data application, mutation acknowledgement and automatic retries continue unchanged
