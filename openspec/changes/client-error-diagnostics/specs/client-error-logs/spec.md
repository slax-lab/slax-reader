# Spec Delta

## Purpose

Make Web and Mobile runtime failures queryable in one shared error table, with the failure mode and Cloudflare request identity needed to tell a JavaScript fault from a sync, transport or rendering failure.

## ADDED Requirements

### Requirement: Capture JavaScript and render failures from the Mobile app

The Mobile app SHALL capture uncaught JavaScript errors, unhandled promise rejections in release builds, and errors raised while rendering the root application tree. A render error SHALL be recorded without changing the existing fallback screen, and capturing it SHALL NOT alter React's error propagation. Native crashes remain the responsibility of Firebase Crashlytics and SHALL NOT be duplicated as records by this capability. Collection SHALL be active only when the build configures an ingestion endpoint.

#### Scenario: An uncaught exception occurs in the JavaScript layer
- **WHEN** the app throws an uncaught `TypeError` in JavaScript
- **THEN** a record with `kind=error`, the error name, message, and compact stack is queued for delivery
- **AND** the existing global error handler still receives the error

#### Scenario: A promise rejects without a handler in a release build
- **WHEN** a release build has a promise rejection that no handler catches
- **THEN** a record with `kind=unhandledrejection` and the rejection reason is queued

#### Scenario: A render error reaches the root boundary
- **WHEN** a component throws while the root application tree renders
- **THEN** a record with `kind=render` and the error is queued
- **AND** the existing fallback screen is shown exactly as before

#### Scenario: A native crash occurs
- **WHEN** the app process crashes natively
- **THEN** no error record is produced by this capability
- **AND** Crashlytics continues to receive the crash

#### Scenario: A build has no endpoint
- **WHEN** a build has no configured ingestion endpoint
- **THEN** no error handler sends any request

### Requirement: Capture failed API requests from Web and Mobile

The Web and Mobile apps SHALL record a failed API request with `kind=network` when the request finally fails with a 5xx response or a network failure after the client's own retries. They SHALL NOT record 4xx responses, cancellations, session replacements, or requests that a later retry completes. Each logical request SHALL produce at most one record, carrying the HTTP method, the path without query or fragment, the status when one exists, and the same online/visibility/foreground context and consecutive-failure count as PowerSync records. Records for synchronization token and synchronization change requests SHALL NOT be produced by this requirement because PowerSync instrumentation already counts those failures. Records MUST NOT include request headers, bodies, tokens, IP addresses, or response content.

#### Scenario: Web receives 500 after its retry
- **WHEN** a Web API request finally returns 500
- **THEN** one `network` record carries the method, path, status 500, and the response Ray ID
- **AND** the caller still receives the same error as before

#### Scenario: Mobile receives 500 after its retries
- **WHEN** a Mobile API request returns 500 on every attempt
- **THEN** one `network` record carries the method, path, status 500, and the response Ray ID

#### Scenario: The request is cancelled or replaced
- **WHEN** a request is aborted because its screen closed or the account changed
- **THEN** no `network` record is created

#### Scenario: A retry succeeds
- **WHEN** a request fails once and a later attempt succeeds
- **THEN** no `network` record is created

#### Scenario: The device is offline
- **WHEN** a request fails because no network is available
- **THEN** one `network` record carries the offline state and no Ray ID
- **AND** the absence of a Ray ID means no HTTP response reached the client

#### Scenario: Synchronization requests fail
- **WHEN** a synchronization token or change request fails
- **THEN** no `network` record is produced by this requirement

### Requirement: Capture PowerSync failures once with their failure mode

The Web and Mobile apps SHALL record PowerSync failures with `kind=powersync`, covering local database initialization, credential acquisition, connection establishment, stream failures during an established or connecting session, and rejected uploads. Each failure SHALL be counted once: when more than one observation point can see the same failure, exactly one SHALL produce the record and the others SHALL NOT. Every PowerSync record SHALL include the failure phase, the online state, whether the app was in the foreground, and the connection uptime when a connection existed. Web SHALL also include the document visibility state. Every PowerSync record SHALL include the number of consecutive failures in the current session for its failure family. The phase SHALL be one of `token`, `connect`, `stream`, or `upload`; a local database initialization failure SHALL use `connect` with `stage=init`. Records MUST NOT include sync tokens, credentialed endpoints, article content, queued change payloads, or IP addresses.

#### Scenario: A change upload is rejected
- **WHEN** the sync API rejects a change upload and the SDK schedules a retry
- **THEN** one `powersync` record carries phase `upload`, the failure details, and the response Ray ID when exposed
- **AND** the SDK's retry loop continues exactly as before

#### Scenario: The sync stream fails repeatedly
- **WHEN** the sync stream fails with the same error on consecutive retries
- **THEN** the first failure is delivered promptly and later ones are counted into fewer records whose `count` values add up to every failure
- **AND** each record carries the consecutive failure count

#### Scenario: Credentials cannot be acquired
- **WHEN** the app cannot obtain valid synchronization credentials
- **THEN** one `powersync` record carries phase `token` for that attempt

#### Scenario: The connection cannot be established
- **WHEN** connecting to the sync service fails before a stream is established
- **THEN** one `powersync` record carries phase `connect` for that failure

#### Scenario: The local database cannot initialize
- **WHEN** PowerSync initialization fails and the app uses its recovery or REST fallback
- **THEN** one `powersync` record carries phase `connect` and `stage=init`

#### Scenario: Web shares one worker across tabs
- **WHEN** a shared Web worker fails once while several tabs are open
- **THEN** one occurrence is recorded

#### Scenario: Synchronization is healthy
- **WHEN** PowerSync connects and completes a sync without errors
- **THEN** no `powersync` record is created
- **AND** the consecutive failure count for its family resets

#### Scenario: The device goes offline
- **WHEN** the network becomes unavailable and the app pauses synchronization
- **THEN** no PowerSync failure record is created for the pause itself

### Requirement: Correlate failures with Cloudflare by Ray ID

When a failed API or PowerSync request received an HTTP response whose `cf-ray` header was readable, the record SHALL carry that value in `properties.ray`. When the request received no response, the record SHALL omit the ray. For requests made through the app's own HTTP client, an absent ray SHALL mean no HTTP response reached the client, so the request did not reach Cloudflare. PowerSync SDK stream requests do not expose response headers, so their records may omit the ray even when the service answered; an absent ray there is not evidence about reachability. Web SHALL read the value through the API's exposed header, and Mobile reads it directly from the response. No IP address SHALL be recorded, full or truncated.

#### Scenario: A Web API failure has a response
- **WHEN** a Web API request fails with 500 and the response exposes `cf-ray`
- **THEN** `properties.ray` holds that value

#### Scenario: A request never receives a response
- **WHEN** a request fails while offline, or during DNS, TCP or TLS failure
- **THEN** the record omits `properties.ray`
- **AND** for an app HTTP client request that means it did not reach Cloudflare

#### Scenario: A PowerSync upload is rejected with a response
- **WHEN** the sync API rejects an upload and exposes `cf-ray`
- **THEN** the `upload` record carries the ray

#### Scenario: The SDK hides stream response headers
- **WHEN** the SDK reports a stream failure without exposing the response
- **THEN** the record omits `properties.ray` and is not evidence that the request failed to reach Cloudflare

### Requirement: Record recent host timing for Web failures

For a failed Web API or PowerSync request whose host has Resource Timing entries from earlier successful requests, the record SHALL include `properties.net` with `dns_ms`, `tcp_ms`, `tls_ms`, `ttfb_ms` and `protocol` taken from the most recent entry for that host. It SHALL omit `properties.net` when no entry exists and SHALL omit an individual value that is unavailable or negative. Mobile has no Resource Timing and SHALL NOT record `properties.net`.

#### Scenario: A host has an earlier timing entry
- **WHEN** a Web API or PowerSync request fails and an earlier request to the same host has a Resource Timing entry
- **THEN** `properties.net` carries that entry's DNS, TCP, TLS, time-to-first-byte and protocol values

#### Scenario: The slow phase is a handshake
- **WHEN** the earlier entry shows a long DNS, TCP or TLS phase
- **THEN** the record's `properties.net` exposes that value so the slow phase is visible

#### Scenario: No timing entry exists
- **WHEN** no Resource Timing entry exists for the host
- **THEN** the record omits `properties.net`

#### Scenario: Mobile fails a request
- **WHEN** a Mobile API or PowerSync request fails
- **THEN** the record has no `properties.net` because Mobile has no Resource Timing

### Requirement: Skip blocked third-party script failures on Web

The Web collector SHALL NOT record `resource` failures for script URLs whose hostname is or is a subdomain of `googletagmanager.com`, `google-analytics.com` or `static.cloudflareinsights.com`. It SHALL keep recording first-party script failures and Stripe script failures, because a blocked Stripe script blocks checkout. This changes the `resource` capture behavior established by the active `frontend-error-logs` change.

#### Scenario: An ad blocker blocks Google Tag Manager
- **WHEN** `https://www.googletagmanager.com/gtm.js` fails to load
- **THEN** no `resource` record is created

#### Scenario: An ad blocker blocks the analytics beacon
- **WHEN** a script from `google-analytics.com` or `static.cloudflareinsights.com` fails to load
- **THEN** no `resource` record is created

#### Scenario: Stripe is blocked
- **WHEN** a Stripe script fails to load
- **THEN** a `resource` record is created

#### Scenario: A first-party bundle fails
- **WHEN** a first-party script bundle fails to load
- **THEN** a `resource` record is created

### Requirement: Attribute ext-bridge records from the page's user store

On `/x/ext-bridge`, the Web collector SHALL take `user_id` from the same `userStore.userInfo` source the page uses for its bridge responses, and SHALL record `properties.surface=ext-bridge` on every record. It SHALL NOT take the user from the bridge message payload or parse a token for this surface. When that source has no user, the record SHALL omit `user_id`.

#### Scenario: The bridge page has a signed-in user
- **WHEN** an error is captured on `/x/ext-bridge` while the user store has a user
- **THEN** the record carries that user's `user_id` and `properties.surface=ext-bridge`

#### Scenario: The bridge payload carries a different user
- **WHEN** a bridge message contains user information that differs from the page's user store
- **THEN** the record uses the user store value and never the payload value

#### Scenario: The bridge page has no user
- **WHEN** the user store has no user when an error is captured on `/x/ext-bridge`
- **THEN** the record omits `user_id` and still carries `properties.surface=ext-bridge`

### Requirement: Normalize, group, and deliver records

Each record SHALL contain `occurred_at`, `app`, `release`, `env`, `kind`, `fingerprint`, `count`, `message`, and `session_id`, and MAY contain `error_name`, `stack`, `page_url`, `user_id`, `device_id`, and `properties`. `app` SHALL be `web`, `ios`, or `android`. `release` SHALL identify the application version and, on Mobile, the build as `<version>+<buildNumber>` (for example `1.0.33+808`). `env` SHALL be `development`, `preview`, `beta`, or `production`, derived from the build and runtime origin. Mobile SHALL record the current route name in `properties.screen` as a bounded, parameter-free route name and SHALL NOT carry `page_url`; its `page_url` column remains NULL. Web SHALL keep its existing `page_url`. `stack` SHALL hold a compact stack within 4 KiB, with repeated frames collapsed and the number of cut frames reported. URLs inside `message`, `stack`, and `properties` SHALL have their query strings and fragments removed. `user_id` and `device_id` SHALL be the identity at the time of the error, never a token, and occurrences under different users SHALL be counted separately.

A fingerprint's first occurrence in an app session SHALL be delivered promptly. Later occurrences SHALL be counted into the pending record and delivered no more often than an interval that starts at one minute and doubles up to one hour, so a fingerprint's `count` values add up to its occurrences and each record carries the session total. Records SHALL be delivered in batches, including when the page or app moves to the background, and SHALL be bounded in size and number per app session. Delivery SHALL be best effort: a failed delivery SHALL NOT be retried immediately, throw, drain the battery, or change application behavior, and the collector SHALL NOT record errors caused by its own delivery. A failure anywhere in capture, including creating the collector, SHALL NOT propagate to the caller, crash the app, or change PowerSync sync, upload, recovery, authentication, or API behavior.

#### Scenario: The same error fires many times
- **WHEN** one error fires 50 times before a flush
- **THEN** a single record with `count=50` is delivered

#### Scenario: An error recurs for hours while the app stays open
- **WHEN** the same error fires every 40 seconds for 10 hours in one app session
- **THEN** fewer than 20 records are delivered for it, their `count` values add up to 900, and the last carries the session total

#### Scenario: Mobile fails on a screen with route parameters
- **WHEN** an error occurs while the Reader screen is open for a bookmark
- **THEN** `properties.screen` names the route without the bookmark identifier or any URL
- **AND** the record has no `page_url`

#### Scenario: Web fails on a page whose URL has a query
- **WHEN** a Web error occurs on a page whose URL has query parameters
- **THEN** the record's `page_url` omits the query and fragment

#### Scenario: The account changes before delivery
- **WHEN** an error occurs under one account and the user switches accounts before the record is delivered
- **THEN** the record carries the account it occurred under

#### Scenario: The app moves to the background
- **WHEN** queued records exist and the page or app moves to the background
- **THEN** the queued records are sent without waiting for the next flush interval once

#### Scenario: The ingestion endpoint is unreachable
- **WHEN** delivery fails because the endpoint cannot be reached
- **THEN** the application continues normally and no new error record is created for the failure

#### Scenario: Error capture itself fails
- **WHEN** the collector throws on every capture or cannot be created at all
- **THEN** the app starts, authenticates, reads, syncs, uploads, and calls the API as before, and no crash or new error is raised

#### Scenario: An error has a deep stack
- **WHEN** an error with a multi-frame stack is captured
- **THEN** the record's `stack` holds shortened frames with recursion collapsed, within 4 KiB

### Requirement: Admit only well-formed records into the shared error table

Each environment's Web and Mobile ingestion pipelines SHALL admit a record only when its fields match the record format, its `app` is allowed for that pipeline, its `env` belongs to that environment, its `release` matches the required format, its `kind` is allowed, its bounded fields are within their byte limits, and its `occurred_at` falls within the accepted time window. The Mobile pipeline SHALL also require `page_url IS NULL`, SHALL admit only `app` values `ios` and `android`, and SHALL use the same `user_id` rule as the production Web pipeline: `user_id IS NULL OR regexp_like(user_id, '^[0-9]{1,20}$')`. The Web pipeline SHALL keep its existing `app=web`, page-origin and `user_id` rules and SHALL admit `kind=network` in addition to its existing kinds. Both pipelines SHALL insert into the existing `client_errors_sink` and `client_errors.errors` table without changing the table schema, so records from both clients are queryable from one table. Records failing any check SHALL be dropped before storage.

#### Scenario: A production record reaches the test stream
- **WHEN** a record with `env=production` is sent to the test environment's Mobile endpoint
- **THEN** it is not stored in the test table

#### Scenario: A Mobile record reaches the Web pipeline
- **WHEN** a record with `app=ios` or `android` is sent to the Web endpoint
- **THEN** it is not stored

#### Scenario: A Web record reaches the Mobile pipeline
- **WHEN** a record with `app=web` is sent to a Mobile endpoint
- **THEN** it is not stored

#### Scenario: A Mobile record carries a page URL
- **WHEN** a record with `app=ios` and a non-NULL `page_url` is sent to a Mobile endpoint
- **THEN** it is not stored

#### Scenario: A record has an unknown kind
- **WHEN** a record with a kind outside the pipeline's list is sent
- **THEN** it is not stored

#### Scenario: A Web API failure reaches the Web pipeline
- **WHEN** a valid Web record with `kind=network` is sent to its environment's Web endpoint
- **THEN** it is stored

#### Scenario: Mobile has no screen yet
- **WHEN** an error occurs before any route has mounted and the record has no `properties.screen`
- **THEN** the record is admitted if its other fields are valid

#### Scenario: A record exceeds a field bound
- **WHEN** a record's message, stack, or properties exceeds its admitted byte limit
- **THEN** it is not stored

#### Scenario: A Mobile record carries a non-numeric user id
- **WHEN** a record with `app=ios` and a `user_id` outside `^[0-9]{1,20}$` is sent to a Mobile endpoint
- **THEN** it is not stored, matching the production Web pipeline

#### Scenario: A Mobile record carries the release build
- **WHEN** a record with `release=1.0.33+808` is sent to a Mobile endpoint
- **THEN** it is admitted if its other fields are valid

#### Scenario: Both clients write in one environment
- **WHEN** the Web pipeline stores a Web record and the Mobile pipeline stores a Mobile record
- **THEN** both rows are queryable from `client_errors.errors`, the Mobile row has `page_url` NULL, and the Web row keeps its Web `page_url`
