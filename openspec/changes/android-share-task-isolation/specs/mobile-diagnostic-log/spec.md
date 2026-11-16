# Spec Delta

## ADDED Requirements

### Requirement: Android successful closure has durable lifecycle evidence

Android sharing SHALL enqueue its actual terminal result when processing completes, before UI feedback is dispatched. The single terminal result SHALL remain success after successful completion even when cleanup follows. The existing off-main-thread writer SHALL additionally persist at most one schema-v1 `share.lifecycle` event for each observed phase `finish_requested` and `destroyed`, correlated by the existing share/launch identifier and containing only success and finishing booleans besides common fields. The finish-request event MUST NOT be represented as proof that destruction occurred. These closure events are part of one native share lifecycle, not periodic timer/watch logging.

Terminal and lifecycle writes SHALL flush their file descriptor on the writer thread. Normal writer shutdown SHALL drain already queued records without blocking UI closure or suppressing them. Existing quotas, line limits, redaction, error containment, and exactly-one terminal semantics SHALL remain intact. Filesystem failure or forced process termination MUST NOT be represented as guaranteed persistence.

Local export and authenticated diagnostic-upload sanitization SHALL accept these additive Android lifecycle records, retain only their allowlisted fields, and reject malformed phases or boolean fields. Existing iOS, account, and legacy diagnostic formats SHALL remain compatible. No permission, schema version, runtime dependency, or attachment-consent rule changes.

#### Scenario: Success completes while the Activity is not visible
- **WHEN** a share succeeds while the screen is locked or the Activity is backgrounded
- **THEN** its success result is recorded before UI feedback and the observed finish request/destruction are logged under the same share identifier
- **AND** later cleanup does not overwrite success with cancellation

#### Scenario: Destruction follows queued logging
- **WHEN** the Activity is destroyed immediately after completion
- **THEN** normal writer shutdown drains the queued result and lifecycle records into the NDJSON file
- **AND** repeated lifecycle callbacks do not duplicate a phase or terminal record

#### Scenario: Closure logs are exported and uploaded
- **WHEN** a selected diagnostic range includes valid Android finish/destroy records
- **THEN** both privacy filters retain the phase and success/finishing booleans with their share identifier
- **AND** full URLs, titles, tokens, response bodies and extra untrusted fields are excluded

#### Scenario: Logging storage is unavailable
- **WHEN** a terminal or lifecycle write cannot be persisted
- **THEN** the existing bounded recording-failure policy applies and successful Activity closure is not blocked
- **AND** diagnostics do not fabricate a successful write or introduce retries
