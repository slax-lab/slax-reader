# web-local-sync Specification

## Purpose
Provide local database synchronization in the Web reader with browser-compatible initialization and bounded recovery from failed database startup.

## Requirements

### Requirement: Browser-compatible initial worker selection

In production, the Web reader SHALL attempt Dedicated Worker initialization first when SharedWorker is unavailable, the user agent matches Android/iPhone/iPod/iPad case-insensitively, or the browser exposes a truthy `window.safari` marker. Other browser environments with SharedWorker support SHALL retain SharedWorker as their initial mode. Missing browser globals SHALL NOT cause worker-policy evaluation to throw or select shared mode.

#### Scenario: Mobile browser exposes SharedWorker
- **WHEN** a production page starts with SharedWorker available and an Android, iPhone, iPod, or iPad user agent
- **THEN** its first database initialization attempt uses dedicated mode
- **AND** no shared initialization attempt or shared retry delay occurs first

#### Scenario: Desktop Safari exposes SharedWorker
- **WHEN** a production page starts with SharedWorker available and a truthy `window.safari` marker
- **THEN** its first database initialization attempt uses dedicated mode

#### Scenario: Eligible desktop browser
- **WHEN** a desktop browser exposes SharedWorker, has no mobile user-agent match, and has no truthy `window.safari` marker
- **THEN** its first database initialization attempt uses shared mode
- **AND** a Safari compatibility token in a Chrome or Edge user agent alone does not exclude the browser

#### Scenario: Browser does not expose SharedWorker
- **WHEN** a production page starts without SharedWorker support
- **THEN** its first database initialization attempt uses dedicated mode

#### Scenario: Browser globals are unavailable
- **WHEN** worker eligibility is evaluated without window or navigator
- **THEN** shared mode is ineligible without throwing an exception

### Requirement: Preserve safe local recovery

Platform selection SHALL preserve existing bounded recovery. Initialization timeout, cleanup timeout, or cleanup failure SHALL stop further local database attempts for that page initialization and select REST fallback. A definite initialization failure with completed cleanup SHALL permit the existing next-mode recovery path.

#### Scenario: Dedicated initialization does not finish
- **WHEN** a dedicated-first session reaches the initialization timeout
- **THEN** it selects REST fallback without starting another local database instance

#### Scenario: Failed dedicated database cannot be cleaned up
- **WHEN** dedicated initialization fails and cleanup times out or reports an error
- **THEN** it selects REST fallback without trying main-thread initialization

#### Scenario: Dedicated initialization fails and cleanup succeeds
- **WHEN** dedicated initialization fails before its timeout and cleanup completes successfully
- **THEN** recovery can attempt main-thread initialization

### Requirement: Preserve development and stored data behavior

Development SHALL retain main-thread initialization. Changing the initial production worker policy SHALL reuse the existing database identity and storage and SHALL NOT itself clear stored data or pending local mutations.

#### Scenario: Development session
- **WHEN** the Web reader starts in development mode
- **THEN** database initialization uses the existing main-thread path regardless of browser worker eligibility

#### Scenario: Existing Safari database
- **WHEN** a Safari session opens an existing local database after the worker policy changes
- **THEN** the selected mode uses the same database identity and storage
- **AND** the policy change does not trigger a reset or a new database generation

### Requirement: Historical Worker dependencies are retained over a seven-day target window

Production releases SHALL preserve the split PowerSync runtime and its content-hashed dependencies. They SHALL attempt to retain each replaced runtime's complete JavaScript/WASM dependency set at its original origin and paths for 7 days after replacement, covering shared/dedicated database Workers and synchronization. Recoverable, verified eligible resources SHALL be retained. Historical discovery or recovery failures SHALL warn and continue as specified below; the window SHALL NOT be presented as an unconditional availability guarantee. Active dependencies SHALL NOT become ineligible because of build age.

#### Scenario: A surviving Worker loads recoverable dependencies after deployment
- **WHEN** A's Worker remains active after B replaces it, A's complete dependency set is recoverable, and a dependency is requested within the 7-day window
- **THEN** the original URL returns A's original executable resource
- **AND** initialization is not broken by removal of that retained dependency

#### Scenario: Several releases occur while an old tab remains open
- **WHEN** B and C are published within A's retention window and A's dependencies are recoverable
- **THEN** C still serves A's dependency set
- **AND** preservation is not limited to the immediately previous build

#### Scenario: An old build was replaced recently
- **WHEN** A was built more than 7 days ago but was replaced less than 7 days ago
- **THEN** A's dependencies remain eligible for recovery and retention

#### Scenario: The active runtime is old
- **WHEN** the currently serving runtime has remained active for more than 90 days and a new release is prepared
- **THEN** its dependencies remain eligible for recovery and retention
- **AND** unrecoverable historical resources follow the warning policy rather than block the new release

### Requirement: Retention preserves verified resources without damaging the current build

Historical recovery SHALL target the complete emitted dependency graph rather than only WASM or one package's filenames. Retained files SHALL match their verified original bytes. Historical candidates SHALL NOT overwrite validated current-build resources. Invalid or conflicting historical candidates SHALL be skipped with warnings. Copying historical files SHALL NOT renew their retention period; resources no longer required by the current runtime or the target window SHALL be eligible for omission.

#### Scenario: A recoverable SQLite loader depends on another chunk
- **WHEN** an eligible runtime requires a loader, WASM, and a shared chunk, and all three can be verified
- **THEN** all three original resources are retained

#### Scenario: One old dependency cannot be recovered
- **WHEN** one historical dependency fails validation or download but other eligible resources are verified
- **THEN** verified resources are still retained and the failed candidate is skipped
- **AND** the affected runtime is reported as partially recovered or unknown rather than fully covered

#### Scenario: Two runtimes reuse identical resources
- **WHEN** two eligible runtimes reference the same path and bytes
- **THEN** the resource is preserved once while it remains eligible

#### Scenario: A historical candidate conflicts with a current resource
- **WHEN** a historical candidate has different bytes at the content-addressed dependency path of an independently validated current resource
- **THEN** the current resource remains unchanged and the historical candidate is skipped with a warning
- **AND** that historical conflict alone does not block publication

#### Scenario: Historical candidates disagree
- **WHEN** historical sources provide conflicting bytes at a content-addressed dependency path with no authoritative current resource
- **THEN** the ambiguous historical path is omitted with an affected-coverage warning
- **AND** a valid current build can still be published

#### Scenario: An expired dependency was carried by subsequent releases
- **WHEN** a dependency is outside the retention window and no current runtime requires it
- **THEN** a subsequent publication can omit it
- **AND** intervening copies do not reset its retention period

### Requirement: Current-build resource defects stop publication

The new build's own dependency index and complete runtime resource set SHALL be validated independently of historical recovery, and SHALL remain complete and valid in the final publication input. Missing or invalid current resources, an incomplete/invalid current index, digest mismatches, or conflicting current references SHALL stop publication before upload. Historical warning handling SHALL NOT suppress these failures or weaken existing mandatory release checks.

#### Scenario: A new build is missing its WASM
- **WHEN** the new build's own WASM or another required current dependency is missing or invalid
- **THEN** publication stops before upload and reports a current-resource error

#### Scenario: The current index does not describe a valid complete runtime
- **WHEN** the generated current index is missing, invalid, incomplete, or inconsistent with current file bytes
- **THEN** publication stops before upload

#### Scenario: Historical warnings occur alongside a current defect
- **WHEN** historical recovery reports warnings and the current build also fails resource validation
- **THEN** publication still fails because of the current defect
- **AND** no blanket error suppression converts the current defect into a warning

### Requirement: Historical recovery failures warn without blocking publication

Historical discovery/recovery failures SHALL NOT block publication of an otherwise valid current build. This includes unavailable or incomplete history listings, inaccessible snapshots/indexes, unsupported legacy inventory extraction, missing resources, HTML in place of executable content, and invalid historical digests or identities. Invalid candidates SHALL NOT be shipped. CI SHALL emit warning annotations and a release summary describing known gaps or unknown coverage, with affected historical runtime/resource and safe reason when known. Warnings alone SHALL NOT fail the release or require a manual override.

#### Scenario: A historical resource cannot be recovered
- **WHEN** a historical JS or WASM file within the target window is unavailable or invalid and current resources pass validation
- **THEN** the file is skipped with a warning and publication proceeds
- **AND** the release summary identifies the affected coverage without claiming complete retention

#### Scenario: All historical discovery is unavailable
- **WHEN** history listing or access fails so no historical set can be established, while existing release prerequisites and current resource validation pass
- **THEN** publication proceeds with the valid current resources
- **AND** CI reports unknown historical coverage rather than a verified empty history

#### Scenario: Legacy inventory extraction is unsupported
- **WHEN** an old runtime has no generated index and its exact original dependencies cannot be established by supported extraction or an available original artifact
- **THEN** CI records the recovery gap and continues publication of a valid current build
- **AND** waiting for that artifact is not a release prerequisite

#### Scenario: Deployment succeeds but purge fails
- **WHEN** a release is published with historical warnings and its subsequent purge fails
- **THEN** the existing purge failure still fails the job
- **AND** future retention still accounts for the published runtime

#### Scenario: An older application is republished as a rollback
- **WHEN** an authorized rollback uses the normal retention-aware publication procedure
- **THEN** the rollback build's own resource defects block publication
- **AND** verified historical dependencies are merged while historical gaps warn and continue under the same policy

### Requirement: Mutable Worker entries require revalidation

Mutable production PowerSync Worker entry responses SHALL require revalidation and SHALL NOT advertise long-lived immutable caching. The mutable runtime dependency index SHALL follow the same cache policy. Content-hashed dependencies SHALL retain immutable caching and stable bytes. The repair SHALL preserve the existing Worker entry generation rather than introduce a new identity for ordinary application releases.

#### Scenario: A Worker entry is requested after deployment
- **WHEN** a client requests a mutable Worker entry under the corrected caching policy
- **THEN** cached content requires validation before reuse
- **AND** the effective response does not contain a conflicting immutable policy

#### Scenario: A live SharedWorker is reused
- **WHEN** a page connects to an already running compatible SharedWorker
- **THEN** continued operation does not depend on refetching its entry
- **AND** verified recovered dependencies remain available during the retention window, with historical gaps reported by the release

#### Scenario: A hashed dependency or unrelated asset is requested
- **WHEN** a client requests a content-hashed dependency or unrelated hashed application asset
- **THEN** its existing immutable caching remains available

### Requirement: Release recovery preserves local data and reports the actual fallback

Asset-retention and cache-policy changes SHALL preserve the existing database filename, data-version state, pending mutations, and browser-specific initialization policy. Startup diagnostics SHALL distinguish local initialization unavailability from attempted-mode exhaustion; an early stop SHALL NOT claim that every database mode failed. The application SHALL retain its existing stop-on-timeout-or-cleanup-failure behavior.

#### Scenario: First rollout meets an already cached legacy runtime
- **WHEN** a new page starts while a legacy Worker or fresh legacy cached entry is still present
- **THEN** startup remains bounded and uses the existing safe fallback when necessary
- **AND** it does not reset the database, discard pending mutations, or force a page reload

#### Scenario: Cleanup failure ends recovery early
- **WHEN** the first attempted mode fails and its cleanup fails or times out
- **THEN** diagnostics identify the attempted mode and early-stop reason
- **AND** REST fallback is reported without claiming that unattempted modes failed
