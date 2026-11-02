# Spec Delta

## Purpose

Measure the public collection acquisition journey with consistent first-party events, separating browser visits, anonymous sign-in intent, server-confirmed authentication, subscription clicks, and completed subscriptions.

## ADDED Requirements

### Requirement: Distinguishable public collection opens

The Web client SHALL emit `collection_opened` once when usable content for a public collection becomes visible, with its public code as `collection_id`, `surface=public_page`, and the existing `opened_from` semantics. Inbox collection opens SHALL use `surface=inbox`. Rendering a missing, closed, or failed collection SHALL NOT emit a usable public-collection open. Source rendering and client hydration SHALL NOT produce two first-party opens for the same page entry. Pagination within the same mounted collection SHALL NOT count as another open; a later entry or reload SHALL count as another open.

#### Scenario: Direct and in-app public-page entry

- **WHEN** a visitor reaches an available public collection by direct navigation or an in-app transition
- **THEN** one client `collection_opened` identifies that collection and `surface=public_page`
- **AND** the existing `collection_visit` log is not treated as an additional canonical open

#### Scenario: Unavailable collection

- **WHEN** the page displays a closed, missing, or load-error state
- **THEN** no usable `collection_opened` is emitted for that presentation

#### Scenario: Inbox versus public page

- **WHEN** the same collection is opened inside Inbox
- **THEN** its `collection_opened` has `surface=inbox` and is excluded from the public-page denominator regardless of `opened_from`

#### Scenario: Pagination and subsequent entry

- **WHEN** the visitor changes pages within the same collection and later leaves and re-enters it
- **THEN** pagination emits no additional open and the later entry emits one open

### Requirement: Anonymous sign-in modal observation

When an unauthenticated visitor's subscription action on the public collection page actually displays the sign-in modal, the client SHALL emit one `screen_viewed` with `screen_name=signup`, `presentation=modal`, `source_screen=collection`, `collection_id`, and `trigger_element_id=collection_subscribe_button`. Reopening a dismissed modal SHALL create a new observation. Rerendering an already visible modal SHALL NOT create another observation. This instrumentation SHALL preserve presentation, provider availability, dismissal, and redirects.

#### Scenario: Modal appears and is dismissed

- **WHEN** an anonymous visitor clicks subscribe, sees the modal, and dismisses it without selecting Google
- **THEN** a contextual modal view is recorded, with no Google click or authentication-success event caused by that dismissal

#### Scenario: Modal is not displayed

- **WHEN** the existing subscription flow resolves an authenticated user without showing the modal
- **THEN** no sign-in-modal view is emitted

### Requirement: Google intent is attributed independently of authentication

An actual Google button activation inside the collection-origin modal SHALL emit one `element_clicked` with `element_id=login_google_button`, `screen_name=signup`, and the same modal attribution. The event SHALL be submitted before leaving for Google without waiting for analytics delivery. A capture listener and component handler SHALL NOT double-report the activation. Ordinary login-page tracking SHALL retain its current behavior and SHALL NOT inherit collection attribution.

#### Scenario: Google authorization is cancelled

- **WHEN** the visitor clicks Google from the collection modal and later cancels or fails authorization
- **THEN** the click remains observable but no authentication-success fact is emitted for that failed attempt

#### Scenario: Generic sign-in later

- **WHEN** a visitor subsequently starts a normal login without the collection-origin modal context
- **THEN** no stale collection attribution is attached to that login

### Requirement: Server-confirmed authentication preserves optional collection attribution

The existing Google redirect and callback flow SHALL carry the collection-origin metadata into the login request as optional `auth_attribution`. Its allowed fields SHALL be `collection_id`, `source_screen=collection`, `presentation=modal`, and `trigger_element_id=collection_subscribe_button`. The collection code SHALL be an alphanumeric string of 1–64 characters. The receiving API SHALL validate this metadata at its boundary, discard unsupported fields, and omit invalid attribution without changing the outcome of otherwise valid authentication. The metadata SHALL NOT establish user identity, permissions, provider identity, or redirect authority.

After successful authentication, the server SHALL attach valid attribution to the existing `user_created` event for a newly created account or `user_logged_in` for a returning account, with `method=google`. No client SHALL duplicate either success event. Missing metadata SHALL preserve all existing callers, responses, and un-attributed success reporting. OAuth codes, tokens, email addresses, and full redirect URLs SHALL NOT be copied into attribution or analytics properties.

#### Scenario: First Google authentication creates an account

- **WHEN** a collection-origin Google callback successfully creates an account
- **THEN** the server emits the existing `user_created` fact with valid collection attribution and `method=google`
- **AND** analysis counts this as authentication success without requiring `user_logged_in`

#### Scenario: Returning Google user

- **WHEN** a collection-origin Google callback successfully authenticates an existing account
- **THEN** the server emits the existing `user_logged_in` fact with the corresponding collection attribution

#### Scenario: Invalid optional attribution

- **WHEN** valid login credentials arrive with malformed or unsupported collection attribution
- **THEN** authentication proceeds under existing rules and the success event omits invalid attribution
- **AND** client-supplied identity or unknown metadata does not become trusted event identity

#### Scenario: Independent collection flows

- **WHEN** collection A and collection B initiate separate Google redirects
- **THEN** each successful callback carries the attribution from its own redirect, without reading a shared last-visited-collection value

### Requirement: Subscription intent and outcome remain separate

A genuine subscription-button activation on the public collection page SHALL emit one `element_clicked` with `screen_name=collection`, `element_id=collection_subscribe_button`, and `collection_id`, before branching into login or subscription. The control's unavailable/busy behavior SHALL be preserved. The existing server `collection_subscribed` event SHALL remain the subscription-success fact and SHALL only follow a successful subscription write. Automatic resumption after login SHALL NOT emit another button click. Unsubscribe and manage controls SHALL NOT be counted as subscribe clicks.

#### Scenario: Anonymous visitor resumes subscription after login

- **WHEN** the visitor clicks subscribe, completes Google authentication, and the existing flow subscribes automatically
- **THEN** analysis observes one user click and a separate server subscription success, with no synthetic return-path click

#### Scenario: Logged-in visitor subscribes

- **WHEN** an authenticated visitor clicks subscribe and the subscription succeeds
- **THEN** the click and server success are both observed, without requiring a sign-in-modal event

#### Scenario: Subscription is rejected

- **WHEN** an attempted subscription fails or an already-active subscription is rejected
- **THEN** the genuine click remains observable and no new subscription-success fact is emitted

### Requirement: Reporting uses documented identity and observation boundaries

The Q2 tracking plan SHALL define public browser UV by distinct nonempty `device_id` per collection and reporting interval, preserve event-time anonymity through `user_id=0`, and separate event counts from UV and authenticated account counts. It SHALL distinguish all public visitors from the anonymous acquisition cohort. It SHALL use the warehouse's natural-key delivery deduplication, bot filtering from collected UA, and snapshot/time-range reporting. Missing identity or attribution SHALL be reported as a data-quality gap rather than inferred from a later login or a URL alone.

The approved reporting windows SHALL be an ordered 30-minute modal-to-Google-to-authentication diagnostic window and a 2-day (48-elapsed-hour) anonymous-visit-to-subscription window, with immature cohorts labeled. The Q2 window SHALL be measured from the qualifying entry timestamp rather than calendar-day boundaries. Analysis SHALL respect the existing signup-retrospective/login-forward alias policy and SHALL NOT silently reinterpret anonymous pre-login events as authenticated-user history.

#### Scenario: Refreshes and login on the same browser

- **WHEN** a browser opens the collection repeatedly and then authenticates
- **THEN** open counts can exceed browser UV, while a valid stable device identity counts once in the interval and its earlier events retain their recorded anonymous state

#### Scenario: Redelivery and missing dimensions

- **WHEN** the warehouse contains duplicate deliveries and legacy events without the new public-page discriminator
- **THEN** the report deduplicates deliveries, discloses the removed count, and excludes unclassifiable legacy events from the new funnel rather than inventing their surface

### Requirement: Analytics changes are additive and verifiably live

New observations SHALL use the first-party event system. GTM, legacy operational logs, existing Dashboard queries, and unrelated clients SHALL remain compatible. Telemetry failure SHALL NOT prevent opening a page, authentication, or subscription. The analytics dictionary SHALL register the proposed properties and enum values, and events SHALL NOT be declared live until real warehouse records have been verified for both new-user and returning-user Google flows and subscription outcomes.

#### Scenario: Analytics delivery fails

- **WHEN** an event request or background event-stream write fails
- **THEN** the user-facing operation follows its existing success or failure result, independently of analytics delivery

#### Scenario: Implementation exists without warehouse evidence

- **WHEN** automated checks pass but real ingestion or identity continuity has not been verified
- **THEN** the implementation records the gap and the affected dictionary lifecycle entries are not promoted to live
