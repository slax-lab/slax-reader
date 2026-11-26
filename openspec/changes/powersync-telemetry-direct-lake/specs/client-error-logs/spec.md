# Spec Delta

## MODIFIED Requirements

### Requirement: Normalize, group, and deliver records

Each record SHALL contain `occurred_at`, `app`, `release`, `env`, `kind`, `fingerprint`, `count`, `message`, and `session_id`, and MAY contain `error_name`, `stack`, `page_url`, `user_id`, `device_id`, and `properties`. `app` SHALL be `web`, `ios`, or `android`. `release` SHALL identify the application version and, on Mobile, the build as `<version>+<buildNumber>` (for example `1.0.33+808`). `env` SHALL be `development`, `preview`, `beta`, or `production`, derived from the build and runtime origin. Mobile SHALL record the current route name in `properties.screen` as a bounded, parameter-free route name, and SHALL carry `page_url` as `slaxreader://<route>[/<id>]`: the kebab-case route name, plus the record id only for routes that show one record (`slaxreader://reader/<bookmarkId>`), and no other parameter. Before any route has mounted, `page_url` is absent. Web SHALL keep its existing `page_url`. `stack` SHALL hold a compact stack within 4 KiB, with repeated frames collapsed and the number of cut frames reported. URLs inside `message`, `stack`, and `properties` SHALL have their query strings and fragments removed. `user_id` and `device_id` SHALL be the identity at the time of the error, never a token, and occurrences under different users SHALL be counted separately.

Error records have a `kind` other than `telemetry`; `telemetry` rows follow the PowerSync client telemetry requirements and are not grouped, counted or delayed like errors. A fingerprint's first occurrence in an app session SHALL be delivered promptly. Later occurrences SHALL be counted into the pending record and delivered no more often than an interval that starts at one minute and doubles up to one hour, so a fingerprint's `count` values add up to its occurrences and each record carries the session total. Records SHALL be delivered in batches, including when the page or app moves to the background, and SHALL be bounded in size and number per app session. Delivery SHALL be best effort: a failed delivery SHALL NOT be retried immediately, throw, drain the battery, or change application behavior, and the collector SHALL NOT record errors caused by its own delivery. A failure anywhere in capture, including creating the collector, SHALL NOT propagate to the caller, crash the app, or change PowerSync sync, upload, recovery, authentication, or API behavior.

#### Scenario: The same error fires many times
- **WHEN** one error fires 50 times before a flush
- **THEN** a single record with `count=50` is delivered

#### Scenario: An error recurs for hours while the app stays open
- **WHEN** the same error fires every 40 seconds for 10 hours in one app session
- **THEN** fewer than 20 records are delivered for it, their `count` values add up to 900, and the last carries the session total

#### Scenario: Mobile fails on a screen with route parameters
- **WHEN** an error occurs while the Reader screen is open for a bookmark
- **THEN** `properties.screen` names the route without the bookmark identifier or any URL
- **AND** `page_url` is `slaxreader://reader/<bookmarkId>` with no title, query or other parameter

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

#### Scenario: Mobile fails on a screen without a record id
- **WHEN** an error occurs on the Settings or Delete Account screen
- **THEN** `page_url` is `slaxreader://settings` or `slaxreader://delete-account`

### Requirement: Admit only well-formed records into the shared error table

Each environment SHALL have one client ingestion stream and one pipeline that admits both Web and Mobile records into the existing `client_errors_sink` and `client_errors.errors` table without changing the table schema. The pipeline SHALL admit a record only when its fields match the record format, its `env` belongs to that environment, and it satisfies the branch for its `app`. Both branches SHALL require a hexadecimal `fingerprint`, a UUID `session_id`, `count` from 1 to 100000, a valid `error_name` when present, `user_id IS NULL OR regexp_like(user_id, '^[0-9]{1,20}$')`, and `ua` within 1024 bytes. The Web branch SHALL require `app = 'web'`, admit kinds `error`, `unhandledrejection`, `vue`, `resource`, `powersync`, `network` and `telemetry`, and keep its existing release, byte-limit, `device_id` and page-origin rules. The Mobile branch SHALL require `app` `ios` or `android`, admit kinds `error`, `unhandledrejection`, `render`, `powersync`, `network` and `telemetry`, keep its existing release, byte-limit and `device_id` rules, and admit `page_url` only when it is absent or matches `^slaxreader://[a-z-]{1,32}(/[0-9A-Za-z_-]{1,64})?$`. The pipeline SHALL NOT filter on `occurred_at` relative to `now()`, because pipeline SQL evaluates `now()` once at creation; readers bound time with `__ingest_ts`. Records failing any check SHALL be dropped before storage.

#### Scenario: A production record reaches the test stream
- **WHEN** a record with `env=production` is sent to the test environment's endpoint
- **THEN** it is not stored in the test table

#### Scenario: Web and Mobile records reach the same endpoint
- **WHEN** a valid Web record and a valid Mobile record are sent to their environment's endpoint
- **THEN** both are stored in `client_errors.errors`

#### Scenario: A record carries a page address from the other client
- **WHEN** a Web record carries a `slaxreader://` page, or a Mobile record carries an `https://` page
- **THEN** it is not stored

#### Scenario: A record has a kind its client does not produce
- **WHEN** a Mobile record has `kind=vue` or a Web record has `kind=render`
- **THEN** it is not stored

#### Scenario: A telemetry record reaches the pipeline
- **WHEN** a valid Web or Mobile record with `kind=telemetry` is sent
- **THEN** it is stored

#### Scenario: Mobile has no screen yet
- **WHEN** an error occurs before any route has mounted and the record has no `properties.screen` or `page_url`
- **THEN** the record is admitted if its other fields are valid

#### Scenario: A record exceeds a field bound
- **WHEN** a record's message, stack, or properties exceeds its admitted byte limit
- **THEN** it is not stored

#### Scenario: A Mobile record carries a non-numeric user id
- **WHEN** a record with `app=ios` and a `user_id` outside `^[0-9]{1,20}$` is sent
- **THEN** it is not stored

#### Scenario: A Mobile record carries the release build
- **WHEN** a record with `release=1.0.33+808` is sent
- **THEN** it is admitted if its other fields are valid

#### Scenario: The pipeline has run for days
- **WHEN** a valid record that occurred several days after the pipeline was created is sent
- **THEN** it is stored
