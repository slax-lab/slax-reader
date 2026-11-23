## ADDED Requirements

### Requirement: Metadata requests expose bounded correlated server logs

The API SHALL record structured entry and response summaries for GET /content/meta at its existing Edge and Core boundaries, including in production. These summaries SHALL reuse the existing timing phases, platform request correlation and an observed module identity/counter. They SHALL NOT contain request URLs/query values, article content, SQL, authentication data or user identity. Production response headers and authorization/caching behavior SHALL remain unchanged.

#### Scenario: Metadata is delivered
- **WHEN** an article metadata request passes through Edge and Core
- **THEN** both boundaries log their scope, entry/response phase, module/call identity and the same available platform Ray ID
- **AND** response summaries include the actual status and their existing numeric timing phases

#### Scenario: A module receives later metadata requests
- **WHEN** more metadata requests use the same JavaScript module instance
- **THEN** their module identity remains the same and the observed request counter advances
- **AND** the counter is not presented as a provider isolate lifecycle or platform queue measurement

#### Scenario: A request fails
- **WHEN** the Core handler returns an existing error response or the Edge binding rejects
- **THEN** its timing summary reflects the response status or failed outcome without exposing error payloads
- **AND** the existing response/error propagation and retry behavior remain unchanged

#### Scenario: Another content endpoint is invoked
- **WHEN** a visit, collection or other content operation is requested
- **THEN** this metadata diagnostic does not emit extra summaries for that operation
