# Mobile Observability Spec Delta

## Purpose

Give the mobile application production performance telemetry for startup, route readiness and OTA update delivery while preserving the existing product and crash telemetry systems.

## ADDED Requirements

### Requirement: Production performance telemetry is additive and non-blocking

The application SHALL collect production performance telemetry through EAS Observe from release builds, including cold and warm launch, time to first render, time to interactive, bundle load, and, when EAS Update is in use, EAS Update download metrics. The integration SHALL be additive to Firebase Analytics, Crashlytics and the first-party `MobileTelemetry` collectors. Unavailable telemetry, a failed Observe call, or a missing EAS project link MUST NOT block, delay, or change startup, login, reading, synchronization, or first-party event delivery.

#### Scenario: A release build starts with Observe available
- **WHEN** a production build launches and the EAS project is configured
- **THEN** startup and route performance metrics are dispatched without changing route selection or user-visible behavior
- **AND** existing Firebase and first-party events continue to be delivered independently

#### Scenario: Observe is unavailable
- **WHEN** the Observe native module is unavailable, initialization fails, or the device is offline
- **THEN** the application continues startup, authentication, reading and synchronization normally
- **AND** no existing telemetry or user action depends on Observe success

### Requirement: Entry routes define interactive readiness

The application SHALL enable the React Navigation integration before any screen mounts and SHALL record per-screen cold and warm first-render and interactive timings for `Login`, `Library`, `Reader` and `Reauthenticate`. Each entry route SHALL mark interactive when that route is ready for user input. App-wide time to interactive SHALL represent the first interactive entry and MUST NOT wait for full background synchronization, cache completion, or optional remote work.

#### Scenario: The user enters the authenticated library
- **WHEN** Library becomes focused and its initial interactive surface is ready
- **THEN** Library records its route-scoped render and interactive timings
- **AND** an ongoing sync or automatic-cache task does not delay the interactive marker

#### Scenario: The user opens a reader route
- **WHEN** Reader is opened from the library or a deep link
- **THEN** Reader records its own route-scoped readiness timing
- **AND** the measurement remains distinct from the app-wide first-entry timing

### Requirement: Observe data respects privacy and environment boundaries

Observe SHALL identify installations with an anonymous identifier and MUST NOT collect credentials, tokens, article or document contents, or unfiltered sensitive route parameters. The integration SHALL filter configured sensitive route parameters before dispatch. Fixture and debug builds MUST NOT dispatch metrics to the production Observe project. The project SHALL document EAS project linkage, data retention, event quotas, and the fact that Observe is a performance monitor rather than a product analytics or full crash-reporting replacement.

#### Scenario: A route carries sensitive parameters
- **WHEN** a user opens a route whose parameters include credentials, tokens, or other configured sensitive keys
- **THEN** those values are removed before the navigation metric leaves the device
- **AND** the route name remains usable for aggregation

#### Scenario: A fixture or debug build runs
- **WHEN** a controlled fixture or debug build exercises the application
- **THEN** no production Observe metrics are dispatched
- **AND** fixture behavior and existing telemetry remain unchanged

### Requirement: Observe is an approved native integration

`expo-observe` SHALL be the approved optional native dependency for production performance telemetry and SHALL be included through the supported prebuild and native build workflow. It MUST NOT be presented as an OTA-only change. The application SHALL remain buildable with the existing local operator inputs, signing workflow and release admission, and SHALL NOT require Expo Go for Observe.

#### Scenario: Native projects are regenerated
- **WHEN** a contributor regenerates the iOS and Android projects after adding the approved dependency
- **THEN** the native projects include the Observe module through the normal autolinking path
- **AND** the existing operator build inputs and signing checks remain required

### Requirement: Existing telemetry remains authoritative

Firebase Analytics, Crashlytics and the first-party `MobileTelemetry` collectors SHALL remain the product-event and crash-reporting systems. Observe SHALL NOT remove, replace, gate, or silently alter those collectors. Observe error reporting, while in preview, SHALL NOT be presented as a replacement for Crashlytics or as complete native crash symbolication.

#### Scenario: A product event or crash occurs
- **WHEN** the application records a product event or a crash with the existing collectors
- **THEN** the event or crash continues through the existing Firebase and first-party paths
- **AND** Observe performance data does not become a prerequisite for that delivery
