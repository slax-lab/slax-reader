# Spec Delta

## Purpose

Define durable account-scoped article, image and PDF caching, scheduling and recovery for macOS without tying background work to window visibility.

## ADDED Requirements

### Requirement: Download selection and persistence

Automatic downloads SHALL support latest 30, 50, 100, 200 or unlimited eligible articles with their images/PDFs and preserve existing personal/collection authorization and manual-download behavior. Download intent and valid completion state SHALL survive application restart.

#### Scenario: Restart during download

- **WHEN** the app restarts with an interrupted article or PDF download
- **THEN** the scheduler restores valid intent and resumes missing work without reporting an incomplete file as complete

#### Scenario: Limit changes

- **WHEN** the user reduces the automatic cache limit
- **THEN** cleanup applies the new limit without discarding explicitly protected manual content or pending edits

### Requirement: Desktop lifecycle scheduling

Downloads SHALL continue while the main window is hidden. Offline state, system sleep and account retirement SHALL pause or cancel affected network work; network recovery and wake SHALL resume eligible work without duplicate owners. Expensive/constrained network state SHALL be available to the core but SHALL not introduce an unapproved metered-download setting.

#### Scenario: Window closes

- **WHEN** the user hides the main window during a download
- **THEN** the download remains scheduled for the same account

#### Scenario: Sleep and wake

- **WHEN** the system sleeps and later wakes with connectivity
- **THEN** in-flight work is cancelled or paused and valid remaining downloads resume once

### Requirement: PDF integrity and cache identity

PDF caching SHALL use the existing authenticated metadata/file interfaces, validate response status, range bounds, total size and payload length, reject contradictory document identity and verify complete-file SHA-256 before completion. Missing optional ETag alone SHALL not invalidate otherwise valid bytes. Cache files SHALL be account/version scoped and written atomically.

#### Scenario: Wrong range payload

- **WHEN** a server responds with truncated bytes, contradictory total size or a mismatched supplied identity
- **THEN** the range is rejected and cannot become a completed cache

#### Scenario: Complete download

- **WHEN** all ranges are present but the full-file hash differs from the descriptor
- **THEN** completion is rejected and corrupt bytes are not served as verified offline content

### Requirement: Bounded retry cleanup and account retirement

Cache retries and concurrency SHALL be bounded and preserve valid completed data on transient failures. Cleanup SHALL respect active readers, owned file leases and account isolation. Retired account work SHALL not publish progress or recreate files after cleanup.

#### Scenario: Reader holds cache resource

- **WHEN** background cleanup selects a file currently leased by a reader
- **THEN** deletion waits or skips that resource according to its ownership policy

#### Scenario: Account switches during cache write

- **WHEN** old-account download bytes arrive after replacement
- **THEN** the write is rejected or confined to the retired owner and cannot populate the new account

### Requirement: Offline reader feedback

Admitted complete cached documents SHALL open without network access. Missing, corrupt or unauthorized content SHALL use localized normal reader recovery states, while download progress and cache controls remain available through their existing feature surfaces.

#### Scenario: Offline cached PDF

- **WHEN** the user opens a fully verified PDF without connectivity
- **THEN** the PDF and existing local annotations remain readable

#### Scenario: Offline missing article

- **WHEN** the requested article has not been cached
- **THEN** the reader shows a useful offline/retry state and does not misreport a successful download
