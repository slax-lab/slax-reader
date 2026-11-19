# Spec Delta

## Purpose

Make Web and Extension runtime errors, including PowerSync failures, queryable in a per-environment data lake through a fixed record format that the ingestion pipeline enforces.

## ADDED Requirements

### Requirement: Capture runtime errors from Web and Extension

The Web app SHALL capture uncaught errors, unhandled promise rejections, Vue application errors, and failed `<script>` element loads. The Extension SHALL capture uncaught errors and unhandled promise rejections in its background service worker, offscreen document, and extension pages, and Vue application errors in extension pages. Failed loads of images, stylesheets, media, and other non-script resources, `console` output, and Nuxt errors with a 4xx status code SHALL NOT be captured. Collection SHALL be active only when the build configures an ingestion endpoint.

#### Scenario: An uncaught exception occurs on a Web page

- **WHEN** a Web page throws an uncaught `TypeError`
- **THEN** a record with `kind=error`, the error name, message, and stack is queued for delivery

#### Scenario: A script chunk fails to load

- **WHEN** a `<script>` element fails to load
- **THEN** a record with `kind=resource` naming the script URL without its query or fragment is queued

#### Scenario: An image fails to load

- **WHEN** an `<img>` element fails to load
- **THEN** no record is created

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
- **THEN** one record for that error is delivered per flush with its occurrence count

#### Scenario: The local database cannot initialize

- **WHEN** PowerSync initialization fails and the application falls back to REST
- **THEN** a `powersync` record with the initialization error and attempted worker mode is queued

#### Scenario: Synchronization is healthy

- **WHEN** PowerSync connects and completes a sync without errors
- **THEN** no `powersync` record is created

### Requirement: Normalize, group, and deliver records

Each record SHALL contain `occurred_at`, `app`, `release`, `env`, `kind`, `fingerprint`, `count`, `message`, and `session_id`, and MAY contain `error_name`, `stack`, `page_url`, `user_id`, `device_id`, `ua`, and `properties`. `page_url` SHALL contain only the origin and path, and URLs inside `message` and `stack` SHALL have their query strings and fragments removed. Repeated errors with the same fingerprint SHALL be delivered as one record per flush with an occurrence count. Records SHALL be delivered in batches, including when the page is hidden or unloaded, and SHALL be bounded in size and number per page session. Delivery SHALL be best effort: a failure to deliver SHALL NOT throw, retry indefinitely, or change application behavior, and the collector SHALL NOT record errors caused by its own delivery.

#### Scenario: The same error fires many times

- **WHEN** one error fires 50 times before a flush
- **THEN** a single record with `count=50` is delivered

#### Scenario: The page URL carries a token

- **WHEN** an error occurs on a page whose URL has query parameters
- **THEN** the record's `page_url` omits the query and fragment

#### Scenario: An error message embeds a URL with a token

- **WHEN** an error message or stack contains a URL with query parameters
- **THEN** the recorded message and stack keep the URL's origin and path and omit its query and fragment

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

#### Scenario: A record has an unknown kind

- **WHEN** a record with an unlisted `kind` is sent
- **THEN** it is not stored

#### Scenario: A record comes from a foreign origin

- **WHEN** a record's `page_url` names an origin outside the environment's allowlist
- **THEN** it is not stored
