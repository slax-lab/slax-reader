# Snapshot Save Observability

## Purpose

Measure the public snapshot save journey with additive first-party observations, connecting the visitor's save activation, snapshot-origin sign-in, server-confirmed account outcome, and fork save outcome without changing the existing product flow.

## Scope Boundary

This capability defines snapshot save measurement only. It does not define or implement automatic post-authentication saving; that behavior belongs to the separate `snapshot-save-auto-resume` change. Nothing in this capability requires or prohibits that later behavior.

## ADDED Requirements

### Requirement: Snapshot save activations are observable with their source

The Web snapshot reader SHALL emit the existing `element_clicked` first-party observation when an enabled snapshot save control is activated, with `element_id=snapshot_save_button`, `screen_name=detail`, and the source snapshot UUID as `source_bookmark_id`. It SHALL emit the same observation for the anonymous activation before sign-in and for any later authenticated activation, including one after the reader returns to the snapshot page. Disabled, submitting, or already-saved controls SHALL NOT produce this observation. The observation SHALL NOT change the existing login prompt, save request, admission feedback, or navigation.

#### Scenario: Anonymous visitor starts the save journey

- **WHEN** an anonymous visitor activates the enabled save control on a public snapshot
- **THEN** one `element_clicked` identifies `snapshot_save_button`, the detail screen, and the source snapshot
- **AND** the existing sign-in modal opens without a save request

#### Scenario: Authenticated reader completes the save journey

- **WHEN** the same reader returns after authentication and activates the enabled save control again
- **THEN** another `element_clicked` carries the same `source_bookmark_id`
- **AND** the existing save admission request and feedback remain unchanged

#### Scenario: Control is unavailable

- **WHEN** the save control is disabled because metadata is not ready, a request is pending, or the source already has a saved copy
- **THEN** no new snapshot save activation observation is emitted

### Requirement: Snapshot sign-in intent is attributed to the source

When an anonymous snapshot save activation displays the existing sign-in modal, the Web client SHALL emit one `screen_viewed` with `screen_name=signup`, `source_screen=detail`, `presentation=modal`, `trigger_element_id=snapshot_save_button`, and `source_bookmark_id`. Reopening a dismissed modal SHALL create a new observation; rerendering an already visible modal SHALL NOT. An ordinary sign-in without snapshot context SHALL NOT carry snapshot fields.

An actual Google or Apple activation inside the snapshot-origin modal or on the `/auth` recovery page for the same snapshot attempt SHALL emit one `element_clicked` with `screen_name=signup`, `element_id=login_google_button` or `login_apple_button`, and the same complete snapshot attribution before provider navigation. The existing email code flow inside the snapshot-origin modal SHALL include the same snapshot attribution in its login request. The sign-in modal SHALL accept only collection or snapshot modal attribution; HackerLinks acquisition context SHALL remain on the standalone login-page transport and SHALL NOT be accepted as modal attribution. Existing collection attribution SHALL retain its current provider and account-outcome behavior, including the existing Google and email paths and Apple exclusion, and HackerLinks acquisition SHALL retain its existing new-account-only scope.

#### Scenario: Snapshot sign-in modal appears and is dismissed

- **WHEN** an anonymous visitor activates snapshot save and sees the sign-in modal
- **THEN** one contextual `screen_viewed` identifies the snapshot source and the save control
- **AND** dismissing the modal emits no save or authentication-success fact

#### Scenario: Snapshot visitor chooses either provider

- **WHEN** the visitor activates Google or Apple inside the snapshot-origin modal
- **THEN** one attributed provider click is recorded before navigation
- **AND** the snapshot attribution enters that provider's authorization attempt

#### Scenario: Recovery page provider click

- **WHEN** a snapshot-origin callback fails and the `/auth` recovery page offers Google or Apple
- **THEN** activating that provider emits the attributed `element_clicked` with the complete snapshot attribution before navigation
- **AND** the preserved return and referral context remain unchanged

#### Scenario: Snapshot visitor chooses email

- **WHEN** the visitor opens the email code flow inside the snapshot-origin modal and verifies a code
- **THEN** the login request carries the same snapshot attribution
- **AND** no separate modal or provider observation is synthesized

#### Scenario: Ordinary sign-in

- **WHEN** a visitor starts sign-in without a snapshot save context
- **THEN** the modal and provider observations contain no snapshot fields
- **AND** they do not inherit attribution from an earlier snapshot attempt

#### Scenario: HackerLinks login page

- **WHEN** a visitor starts sign-in from a HackerLinks entry without opening the snapshot modal
- **THEN** no modal `screen_viewed` is emitted with acquisition fields
- **AND** acquisition remains on the existing login-page transport

#### Scenario: Existing collection flow

- **WHEN** a visitor starts sign-in from the public collection subscription control
- **THEN** collection attribution retains its current fields, Google and email paths, account-outcome rules, and Apple exclusion
- **AND** no snapshot fields are added

### Requirement: Snapshot sign-in provenance survives OAuth and callback processing

The Google and Apple authorization flows SHALL carry the optional snapshot attribution in their own OAuth `state` and through the `/auth` callback into the existing optional `auth_attribution` member of `POST /v1/user/login`. Each attempt SHALL use only its own context. Missing or invalid optional attribution SHALL NOT prevent otherwise valid authentication. A recoverable callback failure that offers a fresh provider authorization SHALL preserve the snapshot attribution alongside the existing return and referral context.

The no-code `/auth` redirect to `/login` and the `EMAIL_AUTH_USE_EXISTING_LOGIN` recovery link SHALL retain their existing behavior and are not required to carry snapshot attribution in this change.

#### Scenario: Google callback

- **WHEN** a snapshot-origin Google authorization returns with a provider code
- **THEN** the callback submits the same snapshot attribution with the existing Google credential exchange
- **AND** the return destination remains the original snapshot

#### Scenario: Apple callback

- **WHEN** a snapshot-origin Apple authorization returns with provider credentials
- **THEN** the callback submits the same snapshot attribution with the existing Apple credential exchange
- **AND** no collection attribution is inferred or attached

#### Scenario: Independent authorization attempts

- **WHEN** separate attempts carry different snapshot sources or one carries none
- **THEN** each callback and login request uses only its own attribution
- **AND** no attempt inherits another attempt's source snapshot

#### Scenario: Recoverable callback failure

- **WHEN** a snapshot-origin callback fails and the page offers a fresh provider authorization
- **THEN** the recovery action retains the valid snapshot attribution and return context
- **AND** the old authorization code is not resubmitted

#### Scenario: Existing recovery boundaries

- **WHEN** the callback has no code or the provider-conflict flow offers the existing-login recovery link
- **THEN** the existing navigation and recovery behavior is preserved
- **AND** snapshot attribution is not added to those paths by this change

### Requirement: Server-confirmed account facts carry validated snapshot provenance

`POST /v1/user/login` SHALL validate optional snapshot attribution against the closed fields `source_screen=detail`, `presentation=modal`, `trigger_element_id=snapshot_save_button`, and `source_bookmark_id` in the same 8-4-4-4-12 hexadecimal UUID format as `sr_user_bookmark.uuid`. Unsupported members SHALL be discarded. Invalid or absent attribution SHALL be omitted without changing the result of otherwise valid authentication. The same validation SHALL apply to the existing email code path.

After successful authentication, the server SHALL attach valid snapshot attribution to the existing `user_created` fact for a newly created account and to `user_logged_in` for a returning account, for Google, Apple, and email. The event SHALL retain the server-confirmed `user_id`, actual provider `method`, device context, and existing writer ownership. Snapshot attribution SHALL NOT establish identity, permissions, provider identity, or redirect authority. HackerLinks SHALL remain new-account-only, and collection attribution SHALL retain its existing provider and outcome rules.

#### Scenario: New snapshot-origin account

- **WHEN** a valid snapshot-attributed Google or Apple exchange creates a previously unknown account
- **THEN** one existing `user_created` fact contains the validated snapshot attribution and the actual method
- **AND** analysis does not require a companion `user_logged_in`

#### Scenario: Returning snapshot-origin account

- **WHEN** a valid snapshot-attributed Google or Apple exchange authenticates an existing account
- **THEN** the existing `user_logged_in` fact contains the validated snapshot attribution
- **AND** no `user_created` fact is emitted

#### Scenario: Snapshot-origin email code

- **WHEN** a valid snapshot-attributed email code creates or authenticates an account
- **THEN** the existing `user_created` or `user_logged_in` fact contains the validated snapshot attribution and `method=email`
- **AND** the email verification outcome and return target remain unchanged

#### Scenario: Non-UUID snapshot source

- **WHEN** valid credentials arrive with a snapshot `source_bookmark_id` that is not a UUID
- **THEN** authentication succeeds under existing rules
- **AND** the success fact omits snapshot fields rather than accepting an arbitrary string

#### Scenario: Invalid or absent attribution

- **WHEN** valid credentials arrive with missing, malformed, or unsupported snapshot metadata
- **THEN** authentication succeeds under existing rules
- **AND** the success fact omits snapshot fields rather than failing or guessing values

#### Scenario: Forged identity or excess properties

- **WHEN** attribution includes client-supplied identity, method, token, redirect, or unknown members
- **THEN** those members do not enter the event or alter authentication
- **AND** only the four supported snapshot fields can survive validation

#### Scenario: Existing attribution contracts

- **WHEN** a collection-attributed or HackerLinks-attributed login succeeds
- **THEN** its existing provider and new-versus-returning rules remain unchanged
- **AND** snapshot fields are not mixed into that attribution

### Requirement: Fork save outcomes carry the source snapshot

When `POST /v1/bookmark/add_url` receives a target that is a trusted Reader snapshot URL of the form `/b/<uuid>`, the existing `bookmark_saved` fact SHALL include the source snapshot UUID as `source_bookmark_id`, while the destination relation remains `bookmark_id`. The existing `bookmark_save_failed` fact SHALL include the same source for an admission rejection or a rate-limited `add_url` attempt.

Reader snapshot targets without an explicit `http` or `https` scheme SHALL receive the same HTTPS normalization as the save handler before source recognition. A rate-limited `add_url` attempt SHALL use the same bounded telemetry body read when `Content-Length` is absent, so a legitimate small body is not skipped. Bodies exceeding the existing 100 KiB telemetry bound SHALL NOT be parsed, whether or not a length header is present.

Ordinary saves SHALL NOT include `source_bookmark_id`. This includes the content `/add` endpoint, non-reader URLs, and `/b/` paths on untrusted origins. This change SHALL NOT add a new save event name, `save_kind`, `attempt_id`, or a final asynchronous fork-completion event.

#### Scenario: Snapshot fork is accepted

- **WHEN** an authenticated reader saves a trusted snapshot URL through `add_url`
- **THEN** the existing `bookmark_saved` identifies the target as `bookmark_id`
- **AND** `source_bookmark_id` identifies the source snapshot

#### Scenario: Snapshot fork is rejected

- **WHEN** a trusted snapshot save is rejected during admission or by the existing save rate limit
- **THEN** the existing `bookmark_save_failed` carries the source snapshot
- **AND** the failure class and existing HTTP outcome remain unchanged

#### Scenario: Rate-limited snapshot fork without Content-Length

- **WHEN** a trusted snapshot save body within the telemetry bound omits `Content-Length` and is rate-limited
- **THEN** the existing `bookmark_save_failed` carries the source snapshot
- **AND** a body over the telemetry bound remains unparsed and carries no source

#### Scenario: Scheme-less Reader snapshot target

- **WHEN** an `add_url` target omits `http` or `https` but otherwise identifies a trusted Reader `/b/<uuid>` snapshot
- **THEN** source recognition applies the same HTTPS normalization as the save handler
- **AND** a resulting failure carries `source_bookmark_id`

#### Scenario: Ordinary save

- **WHEN** a reader saves an ordinary article URL or submits content through the existing content endpoint
- **THEN** the save event contains no `source_bookmark_id`
- **AND** its existing properties and destination identity remain unchanged

#### Scenario: Lookalike snapshot URL

- **WHEN** an `add_url` target contains a `/b/<uuid>` path on an origin that is not a configured Reader origin
- **THEN** the save is not attributed to that path as a snapshot source
- **AND** the event contains no `source_bookmark_id`

### Requirement: Observability is additive and preserves product behavior

The change SHALL preserve existing event names, required event properties, visible save and login flows, ordinary-save payloads, and existing collection and HackerLinks behavior. Telemetry delivery failure SHALL NOT block a save, sign-in, or authentication outcome. It does not add Mobile `device_id` behavior or claim asynchronous fork completion. Automatic post-authentication saving is outside this capability and is defined by the separate `snapshot-save-auto-resume` change; nothing here requires or prohibits it.

#### Scenario: Telemetry is unavailable

- **WHEN** first-party event delivery fails during a snapshot save or sign-in
- **THEN** the existing user-facing operation follows its normal success or failure path
- **AND** no retry or blocking wait is added to the product flow

#### Scenario: Existing collection and HackerLinks flows

- **WHEN** collection or HackerLinks attribution is used
- **THEN** its existing event fields, provider rules, and new-versus-returning behavior are unchanged
- **AND** snapshot attribution does not replace or reinterpret those facts
