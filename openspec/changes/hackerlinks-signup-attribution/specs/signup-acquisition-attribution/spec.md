# Spec Delta

## Purpose

Attribute newly created Reader accounts to the existing HackerLinks entry links with a minimal, reproducible event contract while keeping authentication, identity, and the two products' telemetry stores independent.

## ADDED Requirements

### Requirement: Capture only a complete supported HackerLinks entry

The Web client SHALL recognize acquisition only when the entry query contains exactly supported values for all three fields: `utm_source=hackerlinks`, `utm_campaign=mvp`, and `utm_medium` equal to `header` or `resource_detail`. It SHALL normalize these to `source`, `campaign`, and `medium`. Missing, partial, duplicated-ambiguous, malformed, or unsupported values SHALL produce no acquisition attribution and SHALL NOT prevent login or registration.

When the existing unauthenticated flow redirects an entry to `/login`, it SHALL preserve the three recognized UTM inputs alongside the existing return target and affiliate inputs. It SHALL NOT persist a global last-source value or require a cookie, local storage, account, database, or HackerLinks event to retain this context.

#### Scenario: Header entry reaches the login page

- **WHEN** an unauthenticated visitor enters Reader through a HackerLinks header URL containing the complete supported UTM triplet
- **THEN** the login flow retains `source=hackerlinks`, `campaign=mvp`, and `medium=header`
- **AND** the existing post-login return target remains unchanged

#### Scenario: Resource-detail entry

- **WHEN** an unauthenticated visitor enters through a supported link with `utm_medium=resource_detail`
- **THEN** the login flow retains the same source and campaign with `medium=resource_detail`
- **AND** no resource identifier, resource URL, staged content, or `utm_content` is copied into attribution

#### Scenario: Incomplete or unsupported entry

- **WHEN** an entry omits any required UTM field or contains an unsupported source, campaign, or medium
- **THEN** the visitor can still authenticate normally
- **AND** no partial or guessed acquisition attribution is created

#### Scenario: Later ordinary login

- **WHEN** a visitor starts an unrelated ordinary login without a supported entry context
- **THEN** no attribution from an earlier HackerLinks attempt is reused

### Requirement: Preserve per-attempt attribution across both OAuth providers

The existing Google and Apple authorization flows SHALL carry the optional three-field acquisition object in their own OAuth `state`, through the `/auth` callback, and into the existing optional `auth_attribution` member of `POST /v1/user/login`. Each authorization attempt SHALL use only its own context. Existing credential fields, provider selection, callback behavior, return targets, and affiliate inputs SHALL remain compatible.

Acquisition attribution SHALL NOT become redirect authority, account identity, provider identity, or an authorization claim. Full landing or redirect URLs, OAuth codes or tokens, email addresses, and unrelated query parameters SHALL NOT be copied into the attribution object. Existing collection attribution SHALL retain its current Google-only behavior and event semantics.

#### Scenario: Google authorization and callback

- **WHEN** a visitor selects Google after a supported HackerLinks entry and returns with a provider code
- **THEN** the callback submits the same three acquisition fields with the existing Google credential exchange
- **AND** no additional client registration-success event is emitted

#### Scenario: Apple authorization and callback

- **WHEN** a visitor selects Apple after a supported HackerLinks entry and returns with provider credentials
- **THEN** the callback submits the same three acquisition fields with the existing Apple credential exchange
- **AND** no collection attribution is inferred or attached

#### Scenario: OAuth cancellation or failure

- **WHEN** authorization is cancelled, callback parameters are invalid, or credential verification fails
- **THEN** the existing authentication error behavior applies
- **AND** no `user_created` or acquisition-attributed success fact is produced

#### Scenario: Independent authorization attempts

- **WHEN** separate attempts have different entry contexts or one has no entry context
- **THEN** each callback and login request carries only its own attribution
- **AND** no attempt inherits another attempt's source, medium, or campaign

### Requirement: Attribute only the server-confirmed account-creation fact

The API SHALL validate optional acquisition attribution at the login-request boundary against the closed three-field contract. Unsupported members SHALL be discarded. If any required member is absent or invalid, the API SHALL omit the complete acquisition attribution while preserving otherwise valid authentication. Client-supplied values SHALL NOT override the authenticated `user_id`, provider-derived `method`, device identity, permissions, or redirect authority.

Only after the existing account flow confirms a newly created account SHALL the server add `source`, `medium`, and `campaign` to its existing `user_created` event. The event SHALL retain the actual `method=google` or `method=apple`, positive server-confirmed `user_id`, current event context, and existing writer ownership. A returning account SHALL produce the existing `user_logged_in` without these acquisition fields and SHALL NOT produce another `user_created`.

Missing or invalid attribution, analytics-stream failure, or event delivery failure SHALL NOT change the authentication response or account outcome.

#### Scenario: New Google account

- **WHEN** a valid HackerLinks-attributed Google exchange creates a previously unknown account
- **THEN** exactly one server `user_created` fact contains the three validated acquisition fields and `method=google`
- **AND** analysis does not require a companion `user_logged_in`

#### Scenario: New Apple account

- **WHEN** a valid HackerLinks-attributed Apple exchange creates a previously unknown account
- **THEN** exactly one server `user_created` fact contains the three validated acquisition fields and `method=apple`

#### Scenario: Returning account

- **WHEN** the same attributed OAuth flow authenticates an existing account
- **THEN** the server emits only the existing `user_logged_in`
- **AND** that event and the HackerLinks registration count receive no new acquisition attribution

#### Scenario: Invalid attribution with valid credentials

- **WHEN** valid credentials arrive with partial, malformed, or unsupported acquisition metadata
- **THEN** authentication and account creation follow the existing rules
- **AND** a resulting success event omits acquisition fields rather than failing or guessing values

#### Scenario: Forged identity or excess properties

- **WHEN** attribution includes client-supplied identity, method, tokens, URLs, content, or other unknown members
- **THEN** those members do not enter the event or alter identity and authorization
- **AND** only the three supported acquisition values can survive validation

### Requirement: Keep telemetry collection and identity scope minimal

Reader SHALL store this observation only as properties of its own server `user_created` record in `logs.events`. It SHALL NOT write to or require reads from `hackerlinks_events`, import HackerLinks page events, create a parallel HackerLinks-specific event name, or join the two telemetry datasets for the registration count.

The count SHALL NOT depend on visitor-to-user stitching. Existing `_su` / `X-Device-ID` and `user_device_alias` behavior SHALL remain unchanged and may be checked for continuity, but missing device identity SHALL NOT cause guessed attribution or block registration. No new identifier, account-system link, historical backfill, or persistent user acquisition dimension is introduced.

#### Scenario: Registration with no usable device identity

- **WHEN** a supported attributed registration has an empty device identifier but otherwise succeeds
- **THEN** the account and `user_created` acquisition properties remain valid
- **AND** the missing device is reported as an identity-quality gap rather than inferred from another user or dataset

#### Scenario: HackerLinks product telemetry

- **WHEN** HackerLinks records its own page or resource interactions
- **THEN** those records remain solely in `hackerlinks_events`
- **AND** Reader receives only the three approved registration-attribution fields through the login flow

### Requirement: Provide a deterministic registration-count query

The event-tracking repository SHALL register a narrowly scoped HackerLinks registration question and define the three new `user_created` properties and their closed enum values in its current main dictionary, using `source` in accordance with the existing domain-entry attribution rule. Its tracking plan SHALL define the primary metric as distinct positive `user_id` values among `user_created` records with the complete valid triplet `source=hackerlinks`, `campaign=mvp`, and `medium=header` or `medium=resource_detail` in a specified UTC registration interval. Records with missing or unsupported attribution members SHALL be excluded from the primary metric and counted separately as data-quality gaps. Optional breakdowns MAY use `medium`, `campaign`, and the existing `method` without adding collected fields, and their sum SHALL reconcile to the primary metric.

The query SHALL define `effective_at` as `occurred_at` when the absolute difference between `occurred_at` and `received_at` is at most 300 seconds, and as `received_at` when that difference exceeds 300 seconds. It SHALL use a fixed Iceberg snapshot and partition pruning by `__ingest_ts`, then deduplicate all scoped records by the documented natural key while retaining the earliest `effective_at`, and only then apply UTC business-time filtering by `effective_at` before counting distinct users. It SHALL report raw and removed duplicate counts and SHALL NOT infer missing attribution from URLs, later logins, device aliases, or HackerLinks telemetry. The result SHALL be described as attributed Reader registrations, not unique HackerLinks visitors, clicks, or a click-to-registration conversion rate.

#### Scenario: Duplicate delivery and repeated returning logins

- **WHEN** the warehouse contains redelivered copies of one registration plus later `user_logged_in` records for the same account
- **THEN** the account contributes one registration after natural-key deduplication
- **AND** returning logins do not increase the count

#### Scenario: Mixed attributed and ordinary registrations

- **WHEN** the interval contains fully attributed HackerLinks registrations, ordinary registrations, and records with only source or other incomplete/unsupported attribution
- **THEN** the primary count includes only positive users with the complete valid HackerLinks triplet
- **AND** incomplete or unsupported records appear only in the separate data-quality count
- **AND** medium and campaign breakdowns reconcile to the selected attributed cohort

#### Scenario: Event and receipt timestamps disagree

- **WHEN** a registration's `occurred_at` and `received_at` differ by more than 300 seconds and fall on opposite sides of the requested UTC interval boundary
- **THEN** `received_at` determines inclusion through `effective_at`
- **AND** a record within the 300-second threshold uses `occurred_at`

#### Scenario: Reproducing a report

- **WHEN** a report is rerun with the same snapshot identifier and UTC interval
- **THEN** its complete-triplet filtering, effective-time rule, deduplication, and distinct-user formula produce the same result
- **AND** the report discloses the snapshot and duplicates removed

### Requirement: Supersede the old scope without rewriting history

The current Q1 activation plan SHALL distinguish its original activation-only scope from the new HackerLinks registration count. A new decision record SHALL explicitly supersede the “no channel attribution” statement for this narrow use case, including rationale, approver, date, code evidence, alternatives, and companion change links.

The frozen `specs/tracking-plan-新用户激活.md` SHALL remain unchanged as a historical snapshot. Current event definitions SHALL exist only in the handbook's main dictionary, while formulas and acceptance obligations SHALL live in the new tracking plan and decision history SHALL live in `decisions/`.

Affected event definitions SHALL NOT be promoted to `live` until real warehouse evidence satisfies handbook C5 and the required human analytics acceptance is recorded.

#### Scenario: Reviewing current and historical definitions

- **WHEN** a reader compares the frozen Q1 snapshot with the current handbook
- **THEN** the current handbook and new decision unambiguously define the HackerLinks exception
- **AND** no second current event dictionary or dated amendment appendix is introduced

#### Scenario: Automated tests pass without warehouse evidence

- **WHEN** implementation checks pass but actual registration events have not been inspected in the warehouse
- **THEN** verification records the gap
- **AND** the affected attribution is not declared live or fully accepted
