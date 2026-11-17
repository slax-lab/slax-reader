# Spec Delta

## Purpose

Keep Web reader startup interactions correct under delayed initialization: preserve reading position and explicit navigation, and distinguish unresolved subscription checks from confirmed access decisions without weakening authorization.

## ADDED Requirements

### Requirement: Initial startup preserves an established reading position

On direct entry or reload of an HTML article, client initialization SHALL NOT replace a position already established by the reader or browser with a default top-of-page position. This SHALL apply whether the article has annotations or not, and whether local data is available or the page uses its existing REST path.

#### Scenario: Reader scrolls before client initialization
- **WHEN** the server-rendered article is readable and the reader scrolls down before client initialization completes
- **THEN** completing initialization does not return the article to the top or to an older saved reading position

#### Scenario: Browser restores a reloaded document
- **WHEN** a reloaded article document has an established browser-restored position
- **THEN** client initialization preserves that position instead of replacing it with a default top position or a different local progress position

#### Scenario: Plain article has no previous position or interaction
- **WHEN** an article has no saved progress, browser-restored position, explicit target, or reading interaction
- **THEN** it opens at the top as before

### Requirement: Local progress restoration yields to reading interaction

An eligible owned HTML article SHALL continue to restore saved progress when no higher-priority navigation destination or reading interaction applies. Reading interaction before or during readiness waiting, saved-position loading, or layout corrections SHALL cancel the remaining automatic progress restoration for that navigation. Scrolling input SHALL count as interaction; typing in an editable control SHALL NOT itself cancel restoration. Cancellation SHALL allow subsequent reading-position saving to continue.

#### Scenario: Saved progress restores without interaction
- **WHEN** an eligible article has saved progress and the reader has not interacted or established another destination
- **THEN** it restores that progress using the existing article-anchor behavior

#### Scenario: Reader interacts while readiness is pending
- **WHEN** the reader scrolls while article or local-data readiness is pending
- **THEN** later readiness does not trigger a saved-progress jump

#### Scenario: Reader interacts while the saved position is loading
- **WHEN** the reader scrolls after the saved-position request starts and before it resolves
- **THEN** its result does not reposition the article

#### Scenario: Reader interrupts layout corrections
- **WHEN** an initial saved-progress restore has run and the reader scrolls before its remaining layout corrections finish
- **THEN** no remaining correction pulls the article back and subsequent reading progress can be saved

### Requirement: Existing navigation destinations remain authoritative

The change SHALL preserve ordinary client-side navigation, browser Back/Forward and BFCache restoration, and explicit highlight/hash navigation. A local reading-progress restore SHALL NOT override a history destination or explicit target. Consuming an explicit target from the URL SHALL NOT enable a competing progress restore later in that same navigation. A later, independent navigation SHALL make its own restoration decision.

#### Scenario: Ordinary client-side page change
- **WHEN** the reader navigates to a different page through an ordinary application link without a history position or explicit target
- **THEN** the existing page-change scroll behavior runs, including default top positioning and eligible article progress restoration

#### Scenario: Browser Back or Forward has a saved position
- **WHEN** browser Back or Forward returns to an article with a history position different from its local saved progress
- **THEN** the history position is restored without a subsequent local-progress jump

#### Scenario: Browser restores a document from BFCache
- **WHEN** Back or Forward restores an article document from BFCache
- **THEN** its preserved viewport is retained without a new startup reset or progress replay

#### Scenario: Highlight link loads slowly
- **WHEN** an article is opened with a valid highlight target and its marks arrive later
- **THEN** the existing passage or root-reply target is located and subsequent URL cleanup does not trigger a local-progress restore

#### Scenario: Explicit hash navigation
- **WHEN** an article opens with or navigates to a valid in-document hash target
- **THEN** existing hash positioning remains effective without a competing saved-progress jump

#### Scenario: Same-page query update
- **WHEN** an ordinary query-only URL update occurs on the current article without a new explicit target
- **THEN** the current viewport is retained and no fresh startup or saved-progress restoration begins

#### Scenario: User selects a passage from a panel
- **WHEN** the reader clicks an existing comment card or an Outline passage anchor
- **THEN** its existing passage navigation and highlighting run without a pending progress correction undoing them

#### Scenario: Reader leaves before restoration completes
- **WHEN** the reader navigates away while readiness, saved-position loading, or a correction is pending
- **THEN** that abandoned restoration cannot move the destination page and the next article does not inherit the previous article's interaction state

### Requirement: Unresolved subscription checks are not subscription denials

For subscription-gated reader actions, the Web application SHALL distinguish pending checks, confirmed active access, confirmed inactive access, and check failures. Pending or failed checks MUST NOT open an upgrade prompt or independently grant a protected action. A pending selection SHALL show accessible local loading feedback and complete the selected action after an active result only while its account, route, and selected panel still match. A failed check SHALL show a recoverable error with an explicit retry action.

#### Scenario: Paid reader selects Chat during a slow profile check
- **WHEN** an authenticated reader selects Chat while the current account's subscription check is pending and the response subsequently confirms an active subscription
- **THEN** the reader sees checking feedback instead of an upgrade prompt and Chat becomes available after confirmation without requiring another click

#### Scenario: Paid reader selects protected Outline during a slow profile check
- **WHEN** an authenticated reader selects an Outline action that currently requires a subscription and the pending check subsequently confirms active access
- **THEN** the action waits with checking feedback and proceeds after confirmation without an upgrade prompt

#### Scenario: Profile check fails
- **WHEN** the subscription check fails through a network or service error without confirming inactive access
- **THEN** the selected protected action remains gated, an explicit retry is offered, and no upgrade prompt appears because of that failure

#### Scenario: Reader retries after a failed check
- **WHEN** the reader explicitly retries a failed subscription check and it confirms active access
- **THEN** the still-selected eligible panel becomes available and the prior failure does not leave the reader permanently classified as expired

#### Scenario: Reader changes the selected panel while checking
- **WHEN** the reader selects another panel or closes the panel before a pending subscription check completes
- **THEN** its result does not reopen or switch back to the abandoned panel

### Requirement: Subscription state follows the current account and confirmed updates

The reader's subscription decision SHALL reflect the current account's eligible profile and existing expiry/type rules, rather than an independent stale default. A previously confirmed current-account result SHALL NOT become inactive solely because a background refresh starts. A subsequent confirmed inactive result SHALL replace an older active result. Persisted data alone MUST NOT bypass existing account verification, and an old account's response MUST NOT affect another account or revive an abandoned reader action.

#### Scenario: Active current-account profile is already confirmed
- **WHEN** the reader has an active subscription result associated with the current account through the existing identity checks and starts a background refresh
- **THEN** starting the refresh does not itself classify the subscription as expired or produce an upgrade prompt

#### Scenario: Server confirms expiry after an older active result
- **WHEN** the current account's refreshed profile confirms no valid subscription under the existing expiry/type rules
- **THEN** subsequent protected actions are denied and the existing upgrade prompt remains available

#### Scenario: Account changes during a pending check
- **WHEN** an active subscriber's check finishes after logout or a switch to another account
- **THEN** that result neither grants the new account access nor opens a panel for the previous account

### Requirement: Existing authorization and public Outline access remain intact

The correction SHALL retain existing authentication, ownership, expiry/type, and server-side subscription enforcement. Confirmed inactive users SHALL receive the existing upgrade flow for protected actions; unauthenticated users SHALL retain the login flow. Existing public/read-only Outline access MUST NOT gain a new subscription prerequisite. Server authorization denials and their established error mappings SHALL remain effective even when the client previously displayed active access.

#### Scenario: User is confirmed unsubscribed or expired
- **WHEN** an authenticated user with a confirmed inactive subscription selects a protected reader action
- **THEN** the existing upgrade flow is shown and the protected action is not executed

#### Scenario: User is not logged in
- **WHEN** an unauthenticated user attempts an action that currently requires login
- **THEN** the existing login flow applies without treating the user as an active subscriber

#### Scenario: Read-only Outline is already publicly available
- **WHEN** a reader opens an existing Outline allowed by the current public/read-only access rules
- **THEN** that access remains available without waiting for or requiring a paid subscription

#### Scenario: Client and server disagree about access
- **WHEN** the client has an older active profile but the server rejects a protected request through an existing authentication, ownership, or subscription rule
- **THEN** the request remains denied and the established error handling is preserved rather than bypassed by the client state
