# Spec Delta

## Purpose

Make Web runtime errors, including PowerSync failures, queryable in a per-environment data lake through a fixed record format that the ingestion pipeline enforces.

## ADDED Requirements

### Requirement: Capture runtime errors from the Web app

The Web app SHALL capture uncaught errors, unhandled promise rejections, Vue application errors, and failed `<script>` element loads. Failed loads of images, stylesheets, media, and other non-script resources, `console` output, and Nuxt errors with a 4xx status code SHALL NOT be captured. The Extension SHALL NOT report errors; the PowerSync bridge page it embeds is part of the Web app. Collection SHALL be active only when the build configures an ingestion endpoint.

#### Scenario: An uncaught exception occurs on a Web page

- **WHEN** a Web page throws an uncaught `TypeError`
- **THEN** a record with `kind=error`, the error name, message, and compact stack is queued for delivery

#### Scenario: A script chunk fails to load

- **WHEN** a `<script>` element fails to load
- **THEN** a record with `kind=resource` naming the script URL without its query or fragment is queued

#### Scenario: An image fails to load

- **WHEN** an `<img>` element fails to load
- **THEN** no record is created

#### Scenario: An Extension context throws

- **WHEN** the Extension background, offscreen document, or an Extension page throws
- **THEN** no record is sent

#### Scenario: A page reports not found

- **WHEN** a page raises a Nuxt error with status code 404
- **THEN** no record is created

#### Scenario: A build has no endpoint

- **WHEN** a build has no configured ingestion endpoint
- **THEN** no error handler sends any request

### Requirement: Capture PowerSync failures

The Web app SHALL record PowerSync failures with `kind=powersync` from SDK download errors, SDK upload errors, SDK error-level log records, and the application's local database initialization, connection, reset, and lifecycle failures. Each record SHALL identify its source and, where known, the database worker mode. A failure SHALL be recorded even when the application handles it or the SDK retries it.

#### Scenario: Uploading local changes is rejected

- **WHEN** the sync API rejects a change upload and the SDK schedules a retry
- **THEN** a `powersync` record describing the upload failure is queued

#### Scenario: The sync stream fails repeatedly

- **WHEN** the sync stream fails with the same error on consecutive retries
- **THEN** the first failure is delivered at once, and later ones are counted into a few records whose `count` values add up to every failure

#### Scenario: The local database cannot initialize

- **WHEN** PowerSync initialization fails and the application falls back to REST
- **THEN** a `powersync` record with the initialization error and attempted worker mode is queued

#### Scenario: Synchronization is healthy

- **WHEN** PowerSync connects and completes a sync without errors
- **THEN** no `powersync` record is created

### Requirement: Normalize, group, and deliver records

Each record SHALL contain `occurred_at`, `app`, `release`, `env`, `kind`, `fingerprint`, `count`, `message`, and `session_id`, and MAY contain `error_name`, `stack`, `page_url`, `user_id`, `device_id`, `ua`, and `properties`. `stack` SHALL hold a compact stack, never the raw full stack: every frame reduced to its function and file position, with immediate repeats collapsed, bounded at 4 KiB, and ending with the number of frames cut when the bound is reached. `page_url` SHALL contain only the origin and path, with share and collection codes in the path replaced by placeholders, and URLs inside `message` and `stack` SHALL have their query strings and fragments removed, including in `fn@url:line:col` frames. A fingerprint's first occurrence in a page session SHALL be delivered promptly. Later occurrences SHALL be counted into the pending record and delivered no more often than an interval that starts at one minute and doubles up to one hour, so the `count` values of a fingerprint's records add up to its occurrences and each record carries the session total. Records SHALL be delivered in batches, including when the page is hidden or unloaded, and SHALL be bounded in size and number per page session. Delivery SHALL be best effort: a failure to deliver SHALL NOT throw, retry indefinitely, or change application behavior, and the collector SHALL NOT record errors caused by its own delivery. A failure anywhere in error capture, including creating the collector, SHALL NOT propagate to the caller, raise a new page error or unhandled rejection, stop the app from starting, or change PowerSync sync, upload, recovery, or console output.

#### Scenario: The same error fires many times

- **WHEN** one error fires 50 times before a flush
- **THEN** a single record with `count=50` is delivered

#### Scenario: An error recurs for hours on an open page

- **WHEN** the same error fires every 40 seconds for 10 hours on one page
- **THEN** fewer than 20 records are delivered for it, their `count` values add up to 900, and the last carries `session_count=900`

#### Scenario: The page URL carries a token

- **WHEN** an error occurs on a page whose URL has query parameters
- **THEN** the record's `page_url` omits the query and fragment

#### Scenario: An error occurs on a share or collection page

- **WHEN** an error occurs on `/s/<share code>` or `/c/<collection code>/<member id>`
- **THEN** the record's `page_url` path is `/s/:code` or `/c/:code/:id`, without the code that grants access

#### Scenario: An error message embeds a URL with a token

- **WHEN** an error message or stack contains a URL with query parameters
- **THEN** the recorded message and frame keep the URL's origin and path and omit its query and fragment

#### Scenario: Error capture itself fails

- **WHEN** the collector throws on every capture, or cannot be created at all
- **THEN** the app starts, PowerSync initializes, connects, uploads, and retries as before, its console output is unchanged, and no new page error or unhandled rejection is raised

#### Scenario: An error has a deep stack

- **WHEN** an error with a multi-frame stack is captured
- **THEN** the record's `stack` holds the shortened frames, with recursion collapsed, within 4 KiB

#### Scenario: The visitor closes the tab

- **WHEN** queued records exist and the page becomes hidden
- **THEN** the queued records are sent without waiting for the next flush interval

#### Scenario: The ingestion endpoint is unreachable

- **WHEN** delivery fails
- **THEN** the application continues normally and no new error record is created for the failure

### Requirement: Admit only well-formed records per environment

Each environment's ingestion pipeline SHALL admit a record only when its fields match the record format, its `env` belongs to that environment, and its `page_url`, when present, belongs to an origin allowed for that environment. Records failing any check SHALL be dropped before storage. Admitted records SHALL be queryable from the environment's error table.

#### Scenario: A production record reaches the test stream

- **WHEN** a record with `env=production` is sent to the test environment's endpoint
- **THEN** it is not stored in the test table

#### Scenario: A record claims to come from the Extension

- **WHEN** a record with `app=extension` or a `chrome-extension://` page URL is sent
- **THEN** it is not stored

#### Scenario: A record has an unknown kind

- **WHEN** a record with an unlisted `kind` is sent
- **THEN** it is not stored

#### Scenario: A record comes from a foreign origin

- **WHEN** a record's `page_url` names an origin outside the environment's allowlist
- **THEN** it is not stored
