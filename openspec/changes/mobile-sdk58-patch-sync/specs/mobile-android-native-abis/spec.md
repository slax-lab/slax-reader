# Spec Delta

## Purpose

Define which Android CPU architectures Mobile ships native libraries for, and keep that choice stable across native project regeneration.

## ADDED Requirements

### Requirement: Android builds ship ARM native libraries only

Mobile Android builds SHALL package native libraries for `armeabi-v7a` and `arm64-v8a` only, and SHALL NOT package `x86` or `x86_64` libraries. Both ARM ABIs SHALL remain, so that x86 ChromeOS devices that translate only 32-bit ARM code can still run the application. The ABI list SHALL be owned by the application's config plugin, so regenerating the native project restores it. A local build MAY override the list explicitly for development on an x86 emulator; that override MUST NOT change the committed default.

#### Scenario: A release bundle is built from the committed project
- **WHEN** an Android release bundle is built without an architecture override
- **THEN** it contains native libraries under `armeabi-v7a` and `arm64-v8a`
- **AND** it contains no `x86` or `x86_64` native library directory

#### Scenario: The native project is regenerated
- **WHEN** the Android project is regenerated from a template that lists all four ABIs
- **THEN** the generated `reactNativeArchitectures` property lists only `armeabi-v7a` and `arm64-v8a`, exactly once

#### Scenario: An ARM device installs the application
- **WHEN** an ARM phone or tablet installs a build produced under this requirement
- **THEN** it receives and loads the native libraries for its own ARM ABI, unchanged from the previous four-ABI build
