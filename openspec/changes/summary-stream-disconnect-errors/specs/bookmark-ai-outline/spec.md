## ADDED Requirements

### Requirement: A summary stream whose client has left ends without service-error logs

When the client stops reading the `POST /v1/aigc/summaries` response, the response stream rejects further writes. The API SHALL treat that as the end of the generation: it MUST NOT write failure text to the rejected stream, MUST NOT close that stream again, and MUST NOT report the departure at error level. The departure SHALL be reported once at warning level, with the request's Ray ID when available. A failed write of failure text and a failed terminal close SHALL also be reported at warning level, because they mean the response can no longer be delivered. A provider failure on a stream the client is still reading SHALL remain an error-level log with its diagnostic fields, SHALL still write the failure text and close the stream, and an interrupted stream SHALL NOT store a summary.

#### Scenario: Client leaves mid-stream

- **WHEN** the client stops reading while the summary is streaming
- **THEN** generation stops, nothing is stored, and the request produces one warning instead of error-level logs

#### Scenario: Client leaves before the stream is closed

- **WHEN** generation completes and the client has already gone before the terminal close
- **THEN** the complete summary is stored and the failed close is reported as a warning, not as a service failure

#### Scenario: Provider fails on a live stream

- **WHEN** the model call fails while the client is still reading
- **THEN** the failure text is written, the stream is closed, and the failure is logged once at error level with its provider diagnostic fields
