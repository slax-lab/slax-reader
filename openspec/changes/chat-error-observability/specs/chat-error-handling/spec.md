# Spec Delta

## Purpose

Makes AI chat fail loudly and recoverably on both ends of the stream: the server always terminates the event stream, failures reach the user as an actionable message that matches what the system actually does, provider transient unavailability is distinguishable from provider configuration or authentication failure, bounded timeouts replace indefinite pending, and provider failure detail is retained for operators without leaking secrets.

## ADDED Requirements

### Requirement: The chat stream always terminates

The `/v1/aigc/chat` event stream SHALL be closed on every exit path of the chat handler — provider failure, request validation exit, unknown tool call, or any unexpected exception raised before, during, or after the model call — and the close SHALL complete before the handler's background task is considered finished. A stream SHALL NOT remain open after the handler has stopped producing data.

#### Scenario: Provider failure terminates the stream

- **WHEN** the model call fails for any reason
- **THEN** the handler writes its terminal error frame and closes the stream, and the client observes the stream end rather than an indefinitely pending response

#### Scenario: Validation exit terminates the stream

- **WHEN** the request is rejected before any model call is made (no messages, a malformed tool-call message, or an unknown function call)
- **THEN** the handler still closes the stream

#### Scenario: Unexpected exception terminates the stream

- **WHEN** the handler raises an exception outside the model call
- **THEN** the handler still closes the stream

#### Scenario: Close is awaited

- **WHEN** the handler finishes, successfully or not
- **THEN** the stream's writable side has been closed by the time the background task's promise settles, so a runtime teardown cannot interrupt the close

### Requirement: Failure reaches the client as an actionable error frame

On failure the server SHALL emit exactly one error frame before closing the stream, using the API's existing error envelope `{data, message, code}` where `data` is a stable error code, `message` is a user-facing message, and `code` is the numeric status. The frame SHALL be emitted in the framing the existing client-side error path parses.

#### Scenario: Error frame shape

- **WHEN** the model call fails
- **THEN** the stream carries one frame matching `{"data": "<ERROR_CODE>", "message": "<user-facing text>", "code": <number>}` and then ends

#### Scenario: Failure is not disguised as assistant content

- **WHEN** the model call fails
- **THEN** the failure is delivered as an error frame, not as ordinary assistant message text

#### Scenario: Exactly one error frame

- **WHEN** the handler fails
- **THEN** exactly one error frame is written, regardless of how many internal layers observed the failure

### Requirement: Error copy matches actual system behavior

User-facing AI provider error messages SHALL NOT claim or promise a recovery action the system does not perform.

#### Scenario: No false failover claim

- **WHEN** any AI provider error message is produced by the server
- **THEN** it contains no statement that the system is switching to, or has switched to, a backup provider

#### Scenario: Message states the available action

- **WHEN** a provider error reaches the user
- **THEN** the message says the request could not be completed and identifies retrying as the available action, without promising a recovery the system does not perform

### Requirement: Provider unavailability is distinguished from provider configuration failure

The server SHALL classify provider failures into distinct error codes, distinguishing transient unavailability from configuration or authentication failure, so that the user-facing message and operator diagnosis differ.

#### Scenario: Transient provider unavailability

- **WHEN** the provider returns a 5xx status, reports an overloaded condition, fails at the network level, or exceeds the first-byte budget
- **THEN** the failure is reported with the transient-unavailable code and a message indicating the service is temporarily unavailable and that retrying is appropriate

#### Scenario: Provider authentication or configuration failure

- **WHEN** the provider returns 401 or 403
- **THEN** the failure is reported with a distinct configuration/authentication code and a message indicating a service-side configuration problem, not a user error and not something retrying will fix

#### Scenario: Rate limiting keeps its existing code

- **WHEN** the provider returns 429
- **THEN** the failure is reported with the existing rate-limit code

#### Scenario: Unclassified failure has a neutral fallback

- **WHEN** a provider failure matches no specific class
- **THEN** it is reported with the generic AI provider error code and a message that describes the failure without claiming any recovery action

### Requirement: Streaming chat has a first-byte timeout budget

The server SHALL abort a streaming chat model request that produces no first streamed chunk within a bounded budget, and SHALL surface that abort as a transient provider failure rather than leaving the request pending.

#### Scenario: No first byte within the budget

- **WHEN** the provider accepts the request but produces no streamed chunk within the budget
- **THEN** the request is aborted, the failure is reported as transient unavailability, and the stream is closed

#### Scenario: Prompt first byte is not interrupted

- **WHEN** the provider produces its first chunk within the budget
- **THEN** the stream continues without being aborted by the first-byte budget

#### Scenario: Timeout is not misclassified

- **WHEN** the request is aborted because the first-byte budget elapsed
- **THEN** it is classified as transient unavailability, not as an unclassified failure and not as a client-visible success

### Requirement: The client always leaves the loading state

The web chat client SHALL leave its loading state on every terminal outcome of a chat stream: clean end of stream, received error frame, stream read failure, request failure, and client-side timeout. The loading indicator SHALL NOT persist after the stream has stopped.

#### Scenario: Clean end of stream

- **WHEN** the stream ends normally after delivering content
- **THEN** the client leaves the loading state

#### Scenario: Error frame received

- **WHEN** the stream delivers an error frame
- **THEN** the client leaves the loading state and shows the error to the user

#### Scenario: Stream read fails

- **WHEN** reading the stream rejects (for example the connection drops mid-answer)
- **THEN** the client leaves the loading state and shows an error to the user instead of raising an unhandled rejection

#### Scenario: Request never starts

- **WHEN** obtaining the stream consumer fails or yields nothing to consume
- **THEN** the client leaves the loading state and shows an error to the user

#### Scenario: Stream ends with no output at all

- **WHEN** the stream ends having delivered no data at all — no content, no error frame, and no status frame
- **THEN** the client leaves the loading state and shows an error to the user rather than stopping silently

### Requirement: The client bounds a stalled stream

The web chat client SHALL abort a chat stream that delivers no data for a bounded interval and surface that abort as an error, so that a stalled or dead server cannot leave chat loading indefinitely.

#### Scenario: Stream stalls

- **WHEN** no data arrives for the client-side interval
- **THEN** the client aborts the request, leaves the loading state, and shows a timeout error

#### Scenario: Data keeps arriving

- **WHEN** the stream continues delivering data within the interval, including tool-progress frames
- **THEN** the client does not abort, regardless of how long the overall answer takes

### Requirement: Provider failure detail is retained for diagnosis without leaking

Provider failure detail SHALL be recorded in a structured, greppable form for operators and SHALL NOT be collapsed into a single opaque message. Provider internals and credentials SHALL NOT be exposed to the client.

#### Scenario: Structured operator log

- **WHEN** a provider call fails
- **THEN** an operator-visible log entry records the failure's distinguishing fields, including the provider status, provider error code, and provider reference id when the provider supplied them

#### Scenario: No secret or internal leakage to the client

- **WHEN** a failure is delivered to the client
- **THEN** the client-visible message contains no API key, no credential, no raw provider payload, and no stack trace

#### Scenario: Distinguishable failure classes are logged

- **WHEN** two provider failures of different classes occur
- **THEN** their log entries differ in the recorded classification fields rather than being indistinguishable

### Requirement: Existing chat streaming behavior is preserved

Successful streaming and existing error handling SHALL continue to work unchanged.

#### Scenario: Normal answer streams normally

- **WHEN** the model answers successfully
- **THEN** content deltas, tool-progress frames, completion progress, and the end-of-stream sentinel are delivered as before

#### Scenario: Existing subscription error is unchanged

- **WHEN** the caller lacks a valid subscription
- **THEN** the existing subscription error code and its client-side message mapping are unchanged

#### Scenario: Existing error codes still map on the client

- **WHEN** the client receives an error code it already maps to a localized message
- **THEN** that mapping is still applied
