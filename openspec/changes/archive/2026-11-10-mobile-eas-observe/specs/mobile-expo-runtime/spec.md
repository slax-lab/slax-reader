# Mobile Expo Runtime Spec Delta

## ADDED Requirements

### Requirement: Non-Pods native targets do not inherit Pods-only compiler wrappers

The generated `SlaxShare` extension target SHALL set its own standard clang compiler and linker settings for both Debug and Release configurations. It MUST NOT inherit project-level ccache wrappers whose paths depend on `PODS_ROOT`, because the standalone extension target has no CocoaPods target or `PODS_ROOT` value. Native project generation SHALL preserve this target-level isolation across repeated prebuilds and pod installs. A production archive SHALL succeed whether ccache is enabled or disabled on the build host.

#### Scenario: A production archive runs with ccache enabled
- **WHEN** the build host enables ccache and archives the main application with the standalone share extension
- **THEN** the share extension links with standard clang settings and does not resolve a `PODS_ROOT`-relative ccache wrapper
- **AND** the share extension is built and embedded without changing its identity, sources, resources, or App Group entitlements

#### Scenario: Native projects are regenerated repeatedly
- **WHEN** prebuild runs again on an existing generated project
- **THEN** the share target keeps its standard compiler and linker settings without duplicating files or build phases
- **AND** the main application target and its CocoaPods integration remain unchanged

### Requirement: EAS Observe is an approved integration group

The optional integration inventory SHALL record `expo-observe` as the user-approved native dependency for production performance telemetry, including its native implementation, privacy implications, and the requirement for a new native build. This approval SHALL NOT authorize an EAS Build migration, backend deployment, store publication, or any other optional dependency.

#### Scenario: A contributor adds the approved Observe dependency
- **WHEN** the dependency is installed and native projects are regenerated
- **THEN** the change is treated as the approved observability integration group
- **AND** release signing, upload and publication remain separately authorized operations
