# Tasks

## 1. Read-time preference

- [x] 1.1 Extract the existing Collection aggregate into a read-only result with vector and internal coverage; route `readUser(id, 'collection')` to it while preserving article reads. Verify an independent normalized equal-weight oracle, no legacy user-index read, no dependency repair and zero vector/DO writes in the existing service tests.
- [x] 1.2 Add cases for 0, 1, 20, 21, 100 and 205 subscriptions, including an entirely missing first page followed by valid inputs, all-missing, invalid values and transport errors. Verify exact coverage, keyset progression, get batches of at most 20, concurrency at most four and no silent truncation.
- [x] 1.3 Exercise the actual PGlite eligibility query and recommendation service across subscribe, unsubscribe/delete, natural expiry, inactive subscription, closed Collection, removed owner/subscriber, own Collection and source replacement. Verify the next observed read changes preference without a subscriber job; preserve cancellation/entitlement rules, candidate exclusions, MMR, response shape, article-feed pause and feedback.

## 2. Remove subscriber maintenance and preserve compatibility

- [x] 2.1 Remove only vector dispatch from the three subscription mutation handlers and expiry-status job. Remove subscriber enumeration from account-deletion vector cleanup, retaining the departing account's own cleanup and all business relation deletion. Verify handler/cron/deletion tests assert normal business effects and no unrelated-user vector targets.
- [x] 2.2 Make the legacy Collection-preference refresh cleanup-only with the retirement reason, exact-key existence check and actual delete verification; preserve task-secret, canonical-path and body checks. Handle old Workflow payloads with retirement-specific steps. Verify no aggregate/source reads or upserts, absent-key no-op, deletion failure/pending, replay of old cached step outputs and isolation of unrelated vectors.
- [x] 2.3 Remove subscription from default refresh stages and reject explicit `--kind subscription` before database/client/network initialization; update help and supported-stage tests. Verify the three remaining stages, dry-run, scopes/cursors, sequential requests and truthful native outcomes stay intact.

## 3. Verification and delivery evidence

- [x] 3.1 Extend the existing local Worker runtime/HTTP harness to invoke the real recommendation route with mutable fixture source boundaries, not just import or compile it. Demonstrate changed source visibility between two requests, subscribe/delete effects, a stale legacy record being ignored, all-missing cold start, denied cross-user access and zero recommendation-time vector mutations. Exercise legacy cleanup through both direct Core and Edge-forwarded authenticated task requests. Record which storage boundaries are fixtures.
- [x] 3.2 Run `pnpm api -- gen:all`, API typecheck, lint and full tests, strict OpenSpec validation, four-Worker public-template dry-run builds and `git diff --check`. Generate dry-run outputs in a dedicated temporary directory and remove only artifacts created by this run. Record local latency/call-count observations without claiming production performance.
- [x] 3.3 Write `validation.md` with commands/results, original-scenario runtime evidence, Bugs/Security/Compliance review and explicit remote visibility/performance gaps. Check stale comments and operator instructions, archive sequencing, affected client-version policy and human hands-on acceptance requirements before any later PR. Leave deployment, production cleanup, push and commit unperformed without separate authorization.
