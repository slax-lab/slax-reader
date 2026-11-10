# Spec Delta

## Purpose

Avoid speculative database alternatives and unnecessary initial downloads of optional interfaces, while preserving real reading functionality, demand loading, authorization and user state.

## ADDED Requirements

### Requirement: Unused database backend alternatives are not speculatively prefetched

Generated Web documents SHALL NOT emit speculative prefetch hints for the identified alternative SQLite JavaScript loaders or the database synchronization WebSocket transport. Actual runtime imports and necessary preload hints SHALL remain available, and unrelated resource hints SHALL not be disabled as a side effect.

#### Scenario: Anonymous login does not need a database
- **WHEN** an anonymous browser opens the built login document and no database operation is requested
- **THEN** the document's resource hints do not initiate downloads of those backend-loader or transport alternatives
- **AND** login content and its existing authentication behavior remain available

#### Scenario: An article or collection actually initializes the database
- **WHEN** an existing reading or collection document requests a database backend under the current startup policy
- **THEN** the selected runtime resources can still be loaded on demand
- **AND** the optimization does not change database initialization or synchronization behavior

#### Scenario: An unrelated critical resource is hinted
- **WHEN** the build emits a required application, style, locale or other unrelated resource hint
- **THEN** the database-specific exclusion does not remove that hint

### Requirement: Resource-hint changes preserve runtime recovery and stored data

Hint filtering SHALL NOT delete or rename emitted database assets, change their required dependency references, alter existing Worker selection/recovery, change authentication or database identity, or clear stored data or pending mutations. Unknown or ambiguously identified build resources SHALL retain their current hint behavior.

#### Scenario: A supported fallback needs another backend
- **WHEN** existing database recovery selects an alternate supported backend
- **THEN** its JavaScript and WASM assets remain reachable through their existing runtime references

#### Scenario: A build resource cannot be classified confidently
- **WHEN** a resource has no recognized backend-loader or transport provenance
- **THEN** the narrow optimization leaves its resource hints unchanged rather than guessing from its generated hash name

#### Scenario: An existing local user returns
- **WHEN** a user with existing local data opens the optimized build
- **THEN** the resource-hint change does not reset their database or discard pending mutations

### Requirement: Bundle results distinguish demand loading from speculation

Verification SHALL compare matching baseline and candidate build profiles for login, snapshot reading, public collection and the personal library. It SHALL distinguish initial executable dependencies, speculative hints, actual runtime-required downloads and observed browser transfers; it SHALL not claim a fixed speedup or complete database removal from hint filtering alone.

#### Scenario: A removed hint is followed by a legitimate runtime request
- **WHEN** an eligible page later requests the same asset for an actual database operation
- **THEN** verification records that demand request separately rather than treating it as speculative loading or claiming the bytes disappeared

#### Scenario: A dependency-only helper refactor leaves article weight unchanged
- **WHEN** other required consumers still retain rendering libraries in the article dependency graph
- **THEN** the report preserves the actual route-level byte result instead of claiming the full rendering bundle was removed


### Requirement: Optional article interfaces load only when needed

An article whose AI and chat panels have not been activated SHALL remain readable without downloading or executing those optional panel implementations and their exclusively required rendering resources. Existing automatic-opening and authorization rules SHALL remain authoritative; activation by those rules counts as demand.

#### Scenario: Ordinary article opens with panels closed
- **WHEN** an article opens without an accepted AI or chat activation
- **THEN** its initial executable dependencies and speculative requests exclude those optional implementations
- **AND** article content, selection and existing primary controls remain available

#### Scenario: Existing policy automatically opens a panel
- **WHEN** the existing policy selects an authorized panel automatically
- **THEN** its implementation loads on demand and the selected panel becomes usable
- **AND** the loading optimization does not change the selected panel or entitlement checks

### Requirement: Deferred interfaces preserve state and initiating intent

Once an optional panel is loaded, closing or switching it SHALL preserve its page-local draft and loaded state. A valid initiating action SHALL be applied exactly once after the destination is ready, and SHALL not be applied after its page or account scope changes. Loading failures SHALL leave the article readable and allow retry.

#### Scenario: First quote opens an unloaded chat
- **WHEN** an authorized user sends a selected quote to chat before the chat panel has loaded
- **THEN** the original quote reaches the ready chat exactly once
- **AND** it is not automatically sent as a network message

#### Scenario: User reopens a panel
- **WHEN** a user enters a draft, closes or switches away from the panel, and reopens it on the same page
- **THEN** the draft and previously loaded state remain present

#### Scenario: Panel loading fails
- **WHEN** an optional panel chunk cannot load
- **THEN** the article remains readable and the failure is visible in that optional surface
- **AND** the user can retry without a storage reset

### Requirement: Programmatic modals defer their implementation downloads

A closed programmatic modal SHALL not add its exclusively required implementation to initial executable dependencies or speculative requests. Invoking it SHALL preserve existing inputs, callbacks, focus, dismissal and authorization behavior. Repeated activation while loading SHALL not create duplicate modal instances, and failed loading SHALL permit a later retry.

#### Scenario: Collection opens without a modal action
- **WHEN** a visitor opens a collection without requesting a modal
- **THEN** unrelated editing, feedback and sharing modal implementations are not downloaded for that visit

#### Scenario: Modal loads after an explicit action
- **WHEN** the user invokes a supported modal action
- **THEN** only the required implementation is loaded and the initiating inputs are preserved
- **AND** confirmation and dismissal retain their existing effects

#### Scenario: Modal loading fails and is retried
- **WHEN** an implementation download fails and the user invokes the action again
- **THEN** failure feedback is provided and a subsequent successful load can open one working modal
