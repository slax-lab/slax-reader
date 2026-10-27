# Newsletter review revision

Approved in conversation on 2026-10-27. This refines `support-newsletter-feed` and the existing application/configuration pull requests. The linked delta specifications are authoritative.

## Constraints

- Keep `feed+<account>@newsletterreader.slax.dev` for dev and `feed+<account>@newsletterreader.slax.com` for production.
- Keep Newsletter REST-first and RSS-only PowerSync behavior. Preserve public IDs and old client table names.
- Do not deploy, change remote routing, merge, read secrets, or rewrite applied migrations.
- Retain permanent address reservations and durable disable/delete cancellation.
- Synthetic EML proves local processing only; real EML and hosted SMTP retries remain separate acceptance work.

## Task 1: Safe persistence expansion

Add `sr_feed`, a full old-source-to-new-source INSERT/UPDATE/DELETE mirror installed before explicit-column backfill, and keep RSS writes authoritative in `sr_rss_feed` during overlapping versions. Generic reads and Newsletter writes use `sr_feed`. Alias the physical source in RSS sync rules to preserve old clients. Migrate old address reservations into a dedicated immutable `newsletter` platform binding with retirement and partial uniqueness; fail on ambiguous ownership. Add a BIGINT identity primary key to receipts while retaining the UUID identity and legacy columns needed by overlapping/unfinished deliveries. Verify migrations on real PostgreSQL-compatible storage, including updates/deletes/leases after backfill.

## Task 2: Synchronous receive and settings

Remove deployment boolean admission; require configured domain and the user Lab. Fold GET address into UserController and provision through existing setting enable. Repeated enable is idempotent; missing/invalid accounts remain repairable. New deliveries await body storage and final transaction; pending duplicates resume, done/cancelled duplicates never republish. No transaction spans R2. Preserve unique admission limits, immutable objects and user-lock final checks. New cleaned MIME staging and existing raw-backed receipts retain a bounded compatibility recovery path until SMTP retries are verified and obligations drained. Do not treat arbitrary Worker exceptions as a proven SMTP retry guarantee.

## Task 3: Content and EML tooling

Use a quiet pure shared content extraction path with full sanitized-mail fallback. Preserve existing HTTP(S) links, expose binary attachment metadata only, strip CID and explicit tracking pixels before sanitization, and retain signed image proxy behavior. Provide offline preview and localhost-only EML replay, including plus-safe envelope parameters. Verify malformed MIME, attachment-only mail, extraction loss, tracking, privacy logs and repeated delivery.

## Task 4: Client setup

Replace address POST with settings enable plus read-only GET. Preserve first-account setup and actionable errors, stable issued addresses, REST Feed and RSS-only local behavior. Verify components and actual browser states; obtain human hands-on acceptance for changed behavior before pushing.

## Task 5: Configuration, verification and PR updates

Remove the obsolete boolean from private configurations and unset non-dev Newsletter domains during the pilot, preserving unrelated bytes. Update English rollout docs with migrations, compatibility recovery, RSS rule alias, SMTP failure gate and EML commands. Run generation, focused/full tests, actual local Workers/storage, browser smoke, strict OpenSpec and Bugs/Security/Compliance review. Update original PRs and preserve their human-owned review state. Real EML and hosted SMTP evidence must be identified as outstanding rather than claimed.

## Review focus

Shared PostgreSQL rolling compatibility, partial binding uniqueness and deletion tombstones, pending duplicate resumption, disable/re-enable races, quota serialization, private content logs, attachment fallback identity, old PowerSync alias, and the difference between local injection and actual SMTP retry.
