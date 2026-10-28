# Mobile OTA Updates Spec Delta

## ADDED Requirements

### Requirement: Production builds receive compatible updates without blocking startup

Mobile builds produced by EAS Build with the `production` profile SHALL check the EAS `production` channel for an update on every cold start without delaying startup. A downloaded update SHALL apply on a later cold start. When the check fails or the device is offline, the build SHALL start with the newest bundle already on the device. An update SHALL reach only installations whose `version(buildNumber)` runtime matches the update.

#### Scenario: An update is published while the user reads
- **WHEN** a compatible update is published and a production build launches with connectivity
- **THEN** startup proceeds on the current bundle while the update downloads in the background
- **AND** the update applies on the next cold start

#### Scenario: The update check fails
- **WHEN** a production build launches and the update check fails or the device is offline
- **THEN** it starts with the newest bundle already available on the device

#### Scenario: An update targets another build
- **WHEN** an update is published for runtime `1.0.25(N)`
- **THEN** installations of any other build continue unchanged

### Requirement: Local and non-production builds never receive production updates

Committed native projects, local Release and archive builds, development clients, controlled UI fixtures, adoption fixtures and builds generated with non-production service origins SHALL disable updates and SHALL NOT request or apply an update from the `production` channel.

#### Scenario: A local test build launches
- **WHEN** the developer builds and launches the app locally from the committed native projects, in Debug or Release
- **THEN** it does not request or apply a production update

#### Scenario: A fixture or test-origin build launches
- **WHEN** a fixture build or a build generated with a non-production API, beta API or web origin launches with connectivity
- **THEN** it does not request or apply a production update

### Requirement: Publishing uses production configuration

The documented publish entry point SHALL publish to the `production` channel for both platforms using the EAS `production` environment and SHALL exclude local operator configuration and dotenv files from the exported bundle.

#### Scenario: The operator publishes a merged JavaScript fix
- **WHEN** the operator runs the publish entry point with a message
- **THEN** both platform bundles are exported with the source production origins and published to the `production` channel
