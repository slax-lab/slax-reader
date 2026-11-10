# Mobile SDK 58 Upgrade

## Purpose

Establish a reproducible native SDK upgrade that preserves existing mobile behavior and makes native acceptance a prerequisite for additional system features.

## ADDED Requirements

### Requirement: SDK upgrade preserves supported application behavior

Mobile SHALL run on the supported Expo SDK 58 runtime while retaining Android API 26 and iOS 16.4 minimum support, existing installation identities, shared authentication, offline data and pending writes. An incompatible minimum-platform requirement MUST be resolved explicitly before acceptance. Upgrade acceptance SHALL cover both native platforms, not JavaScript bundling alone.

#### Scenario: Existing account opens the upgraded application offline
- **WHEN** an existing installation cold-starts without connectivity after the runtime upgrade
- **THEN** the application retains its admitted account data, cached HTML/PDF/images and pending synchronization work
- **AND** credentials and data from a different account remain inaccessible

#### Scenario: Existing native entry points are exercised
- **WHEN** the upgraded application handles provider login callbacks, incoming sharing, purchases, Reader launch or native back
- **THEN** each action retains its existing behavior without duplicate callback delivery or lifecycle crashes
- **AND** canceled back gestures and selection/scroll restoration remain correct

### Requirement: Native generation and release admission are reproducible

Clean and repeated native generation SHALL retain the main app and Share identities, matching package metadata, target embedding, resource ownership and App Group. Configured main-app Firebase SHALL initialize once before its consumers; unconfigured/fixture builds SHALL remain unconfigured and Share SHALL remain Firebase-free. Release admission MUST reject template debug signing in both supported Gradle spellings and preserve unrelated release optimization settings.

#### Scenario: A clean project is generated twice
- **WHEN** the same supported configuration generates both native projects repeatedly
- **THEN** the generated targets, resources, signing guards and callbacks remain valid without duplicate integration
- **AND** missing template insertion points fail clearly instead of producing silently incomplete integration

#### Scenario: A release template retains debug signing
- **WHEN** a generated Release build still selects the template debug identity, with or without an assignment operator
- **THEN** release admission rejects it
- **AND** an explicitly unsigned validation build is never represented as publisher-signed output

### Requirement: Base native acceptance precedes feature adoption

The base upgrade SHALL pass Android Debug and minified unsigned Release builds and iOS Debug and unsigned simulator Release builds before new intent or adaptive-reading dependencies/targets are introduced. Native evidence SHALL identify platform/runtime/configuration and distinguish automated, simulator and user-run service coverage. Per the human decision on 2026-10-20, unavailable user-owned hands-on, account/service and older-OS checks SHALL be recorded as unverified rather than agent PR merge prerequisites; they SHALL NOT be represented as passed. This allocation does not relax runtime behavior, authentication, privacy or account-isolation requirements, and does not waive reproducible simulator defects.

#### Scenario: A base build fails
- **WHEN** either platform fails its base native build or a required native integration is broken
- **THEN** additional native feature adoption remains blocked until that failure is repaired
- **AND** independent upgrade diagnosis and type/test repair can continue

### Requirement: Upgrade validation retains meaningful regression coverage

Final upgrade acceptance SHALL have zero TypeScript errors, no failing mobile tests, successful Android/iOS JavaScript bundles, and affected native resource checks. Harness repairs MUST exercise application and installed-runtime behavior without replacing expected behavior with unconditional mocks, dropping assertions or hiding newly failing tests. Existing accepted skips SHALL remain separately explained.

#### Scenario: Runtime internals or ref types change
- **WHEN** the upgraded runtime invalidates a test host or TypeScript ref declaration
- **THEN** the host/types are updated for the installed runtime while retaining cancellation, lifecycle and interaction assertions
- **AND** final results report actual totals and remaining acceptance limits rather than reusing historical failure counts
