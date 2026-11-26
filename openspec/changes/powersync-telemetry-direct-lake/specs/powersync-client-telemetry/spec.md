# Spec Delta

## MODIFIED Requirements

### Requirement: Record PowerSync phase outcomes in the Reader event lake

Authenticated Web and Mobile app sessions SHALL publish `powersync_phase` observations, and connection-loss observations as `powersync_connection_lost`, directly from the client to the shared client lake table `client_errors.errors` as rows with `kind = 'telemetry'`, through the same per-environment ingestion endpoint as error records. They SHALL NOT be sent through the API's `/events` route. Each row SHALL carry the event name in `properties.event` and SHALL start its `message` with that name followed by bounded grouping words (for example `powersync_phase connect success`). Each `powersync_phase` observation SHALL identify one phase from the single vocabulary `token`, `connect`, `stream`, `upload`, an outcome, and the relevant context. Durations SHALL be nonnegative elapsed milliseconds stored as numbers in `properties.duration_ms` and SHALL be omitted when either timing boundary is unavailable. `submit` and `acknowledge` SHALL remain distinct as `upload` outcomes with a `step` property. The row SHALL carry the same authenticated user, device, release, environment, page and session attribution as an error record from that client; Mobile rows also carry `online` and `foreground` like its error records. Observations MUST NOT include credentials, tokens, credentialed endpoints, article content, mutation payloads, or stack traces.

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
- **WHEN** a stream that reached a connected status becomes disconnected for an unknown reason
- **THEN** one `powersync_connection_lost` observation carries the bounded reason when known

#### Scenario: A disconnect is not a loss
- **WHEN** a connection attempt ends without ever reaching a connected status, a stream failure is already recorded as a phase failure, the client is offline, the page or app is in the background, or the client stopped the stream itself
- **THEN** no `powersync_connection_lost` observation is recorded

#### Scenario: Several observations share a phase and outcome
- **WHEN** two `connect success` observations with different durations are recorded in one session
- **THEN** two `telemetry` rows are stored, each with `count = 1` and its own `duration_ms`
- **AND** an average connect duration can be computed from `client_errors.errors` alone

#### Scenario: The API event route is not used
- **WHEN** any PowerSync observation is recorded
- **THEN** no `powersync_phase` or `powersync_connection_lost` event is sent to `/events`

### Requirement: Failure observations join to error records without double counting

When an observed phase fails, `client_errors.errors` SHALL receive one error row from the failure's single counting source and one `telemetry` row for the phase outcome. The `telemetry` row SHALL carry the error row's fingerprint in `properties.error_fingerprint` and the Ray ID in `properties.ray` when those are available; its own `fingerprint` column identifies the observation group, not the error. The `telemetry` row SHALL NOT carry a stack. Consumers counting errors SHALL exclude `kind = 'telemetry'`, so a failure is counted once.

#### Scenario: An upload failure is observed
- **WHEN** an upload is rejected and the client records a `powersync` error
- **THEN** one `powersync` row and one `telemetry` row for `upload failure` exist, and the telemetry row's `properties.error_fingerprint` equals the error row's `fingerprint`
- **AND** both carry the same Ray ID when the response exposed one

#### Scenario: A stream failure exposes no Ray ID
- **WHEN** the SDK reports a stream failure without exposing the response
- **THEN** the phase outcome carries `properties.error_fingerprint` and omits the Ray ID
- **AND** the absence is not evidence that the request failed to reach Cloudflare

#### Scenario: The failure is counted once
- **WHEN** a failed phase produces an error record
- **THEN** counting rows whose `kind` is not `telemetry` counts that failure once

#### Scenario: A phase succeeds
- **WHEN** a phase completes successfully
- **THEN** only a `telemetry` row is stored for it

### Requirement: Observations are attributable and best effort

Sync telemetry SHALL use a fixed property allowlist and bounded values. It SHALL preserve authenticated account attribution by binding identity when an observation is recorded, discard observations recorded after logout or account change, and suppress duplicate observations for unchanged status or a retained error. Each observation SHALL be delivered with the next collector flush rather than held behind error repeat intervals. Observations SHALL be bounded to 100 pending per flush, dropping the oldest, and 1000 per app session. Delivery SHALL be best effort and SHALL never delay or alter synchronization, session handling, startup, or error capture.

#### Scenario: A status error persists across updates
- **WHEN** PowerSync publishes the same active error over multiple status updates
- **THEN** it is reported once within the observed failure episode
- **AND** a new failure after recovery can be reported again

#### Scenario: A previous account's operation finishes late
- **WHEN** an observation would be recorded after logout or account change
- **THEN** it is not recorded under the next account

#### Scenario: The ingestion endpoint is unavailable
- **WHEN** the client lake endpoint is offline or rejects a batch
- **THEN** connection, data application, mutation acknowledgement and automatic retries continue unchanged

#### Scenario: Observations arrive faster than they can be sent
- **WHEN** more than 100 observations are pending before a flush
- **THEN** the oldest are dropped, the newest 100 are sent, and pending error records are unaffected
