# Spec Delta

## Purpose

Keep optional interfaces and speculative resource downloads out of initial Web loading while retaining readable content, required resources, permissions and page-local state.

## ADDED Requirements

### Requirement: Initial documents avoid speculative resource downloads

Generated Web documents SHALL omit speculative resource-prefetch hints. Required preloads, module imports, styles and actual runtime resource loading SHALL remain available. This policy SHALL NOT remove emitted database assets or change synchronization behavior.

#### Scenario: An anonymous visitor opens login or an article
- **WHEN** a built login, article or collection document is requested
- **THEN** it emits no speculative resource-prefetch links
- **AND** resources required for the rendered document remain loadable

#### Scenario: The existing database policy needs a backend
- **WHEN** the current runtime requests a selected database Worker, loader or WASM resource
- **THEN** that resource remains available with unchanged storage identity and runtime behavior

### Requirement: Optional article panels load on activation

An article whose AI/chat panels have not been selected SHALL remain readable without loading those optional implementations. Existing authorization and automatic-opening rules SHALL decide activation. Closing or switching a loaded panel SHALL preserve its draft and loaded state within the same page/account scope.

#### Scenario: Article opens with panels closed
- **WHEN** neither AI nor chat is selected
- **THEN** their implementations are absent from initial executable dependencies and startup requests
- **AND** the article and its primary controls remain usable

#### Scenario: Panel is reopened
- **WHEN** the user enters a draft, switches or closes the panel, then reopens it
- **THEN** its draft and loaded state remain available within the same account and page

#### Scenario: Existing rules open a panel automatically
- **WHEN** the existing policy selects an authorized panel
- **THEN** its implementation loads on demand without changing the selected panel or entitlement rules

### Requirement: First-use quote intent survives asynchronous mounting

An authorized quote action SHALL reach the ready chat exactly once without automatically sending a message. A pending action SHALL NOT cross account or page scope.

#### Scenario: First quote opens chat
- **WHEN** the user quotes article text before the chat component is ready
- **THEN** the quote appears after chat finishes loading
- **AND** no chat message is submitted automatically

#### Scenario: Account changes during loading
- **WHEN** the account changes before a pending quote is delivered
- **THEN** that quote is not applied to the next account's chat

### Requirement: Programmatic modal implementations load on action

Programmatic modals SHALL load only when invoked and retain their existing inputs, callbacks, focus and dismissal behavior. An implementation load failure SHALL be reported without leaving an empty blocking modal.

#### Scenario: Login modal is requested
- **WHEN** an anonymous user invokes an action requiring login
- **THEN** the login modal loads and preserves its redirect/context inputs

#### Scenario: Modal loading fails
- **WHEN** a required modal module cannot load
- **THEN** the user receives failure feedback and no empty blocking modal remains

### Requirement: Resource errors are contained and recovery is explicit

An optional-panel load failure or timeout SHALL leave the article readable and show local failure feedback. If recovery reloads the page, it SHALL require explicit user action and warn that unsaved drafts can be lost. This revision SHALL NOT promise clearing a browser's failed-module cache within the same document.

#### Scenario: Panel chunk is unavailable
- **WHEN** an optional panel fails to load
- **THEN** the article remains readable and the affected panel shows the failure
- **AND** the page does not reload automatically

#### Scenario: User chooses reload recovery
- **WHEN** the user selects reload after seeing the unsaved-draft warning
- **THEN** the current page reloads without resetting database storage

### Requirement: Measurements separate static loading and speculation

Reports SHALL distinguish initial static dependencies, generated hints, demand requests and observed browser transfers. They SHALL disclose unaffected or regressing route totals and SHALL NOT infer fixed latency improvements from compressed byte estimates.

#### Scenario: A deferred feature is opened
- **WHEN** its resources load after activation
- **THEN** the report records them as demand loading rather than claiming the bytes were eliminated
