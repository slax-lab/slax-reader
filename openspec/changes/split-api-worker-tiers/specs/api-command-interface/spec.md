## MODIFIED Requirements

### Requirement: Single deployment configuration

The API SHALL provide one public `deploy/cloudflare/api.toml.example` and read ignored `api.toml` for development, builds, deployments and runtime type generation. Missing configuration MUST fail explicitly. Configuration SHALL use native Wrangler name/services/env fields. Worker identities SHALL follow native names/service bindings and existing backend naming conventions, with only Edge publicly exposed. The Objects Worker identity SHALL come from `services.OBJECTS.service`, or be derived from the Core name (`reader-core` → `reader-objects`, otherwise `<core>-objects`), and MUST be distinct from every other Worker identity. Bindings and migrations SHALL come from the selected environment. Generated per-Worker configuration SHALL contain only the bindings, entry points, triggers and placement that Worker owns under the API Worker topology.

#### Scenario: Custom deployment
- **WHEN** an operator supplies their own Worker names, API origin and queue names
- **THEN** generated internal bindings and HTTP/queue dispatch use those configured identities
- **AND** resource IDs and migration history are preserved without rewriting operator configuration

#### Scenario: Objects identity is derived or ambiguous
- **WHEN** configuration omits `services.OBJECTS.service`
- **THEN** the Objects Worker name is derived from the Core name
- **WHEN** configuration reuses another Worker's name for the Objects identity
- **THEN** validation fails before any remote operation and names the field

#### Scenario: Offline validation
- **WHEN** an operator builds or generates types
- **THEN** no remote resources are deployed or provisioned
- **AND** type generation uses an isolated runtime-only configuration and an empty env file

#### Scenario: First deployment
- **WHEN** an operator explicitly requests bootstrap
- **THEN** the deployment orders initialization to resolve internal Worker dependency cycles and ends with all bindings installed
- **AND** normal deployment updates never silently enter bootstrap mode

#### Scenario: Unknown queue
- **WHEN** a queue event has no configured or legacy handler
- **THEN** processing fails so messages are not silently acknowledged
