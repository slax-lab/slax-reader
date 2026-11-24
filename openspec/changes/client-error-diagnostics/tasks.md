# Tasks

## 1. Shared packages

- [ ] 1.1 Widen `ClientErrorApp` to `web | ios | android` in `packages/frontend-utils/src/errorLog.ts` and make `capture` return the record fingerprint without changing any record field or Web behavior. Verify with unit tests for a Mobile-shaped record, a disabled collector, a dropped record, and unchanged Web tests.
- [ ] 1.2 Add HTTP status, `cf-ray` and one failure observer to `packages/frontend-utils/src/request.ts`, attaching status and ray to `RequestError` before the body is parsed. Verify with unit tests for JSON and non-JSON 5xx, network errors, aborts, 4xx, and a response without `cf-ray`.
- [ ] 1.3 Add the shared `powersync_phase`/`powersync_connection_lost` event contract and the `token | connect | stream | upload` phase vocabulary to `packages/contracts/src/events.ts`, with numeric duration support. Verify with typecheck and a representative payload test.
- [ ] 1.4 Skip script URLs whose hostname is or is a subdomain of `googletagmanager.com`, `google-analytics.com` or `static.cloudflareinsights.com` in `installGlobalErrorCapture`, keeping first-party and Stripe script failures. Verify with unit tests for each skipped host, a first-party bundle and a Stripe script.

## 2. API

- [ ] 2.1 Add `apps/api/src/utils/errorDiagnostic.ts` with bounded `errorDiagnostic` and `providerDiagnostic` helpers, without importing Prisma. Verify `pnpm api -- typecheck` and unit tests for `Error`, `MultiLangError`, plain objects and non-object throws.
- [ ] 2.2 Add the fields to `RSS refresh commit failed` with no Ray ID and add `ray` to `handleSyncSaveRequest failed` when the request context carries one. Verify with tests that the RSS entry has no ray and the sync entry matches the `CF-Ray` header.
- [ ] 2.3 Replace the bare `console.error(error)` in the summary catch with one structured line carrying the provider fields, bounded message and Ray ID, keeping existing line texts. Verify with a test that a provider failure emits one entry and that absent fields are omitted.
- [ ] 2.4 Add `cf-ray` to `Access-Control-Expose-Headers` and `Timing-Allow-Origin` for `https://r.slax.com`, `https://r-beta.slax.com` and `https://r.slax.dev` in `apps/api/src/middleware/cors.ts`. Verify with assertions on a JSON response, a preflight response, the timing header values and an unchanged media response.
- [ ] 2.5 Emit `bookmark_add_step_failed` for post-save step failures, keep `bookmark_save_failed` for non-persisted saves, and classify blocked targets as `unsupported_target`. Verify with tests for each event shape, the single-change/multi-change sync entry, the step success-rate query and `source_bookmark_id` compatibility.
- [ ] 2.6 Run `pnpm api -- test test/script/layerArchitecture.test.ts`, the affected API suites, typecheck and lint; record the results in `validation.md`.

## 3. Web

- [ ] 3.1 Capture failed API requests from the Web request wrapper with 5xx/network filtering, method, query-free path, status, ray, failure-mode context and `properties.net` from the most recent Resource Timing entry for the host. Verify with tests for 500, 404, abort, retry-then-success, a network failure, a host with timing and a host without it.
- [ ] 3.2 Add `properties.ray` to PowerSync token and upload failures from the response header, and add `online`, `foreground`, `visibility`, `phase`, `connection_ms`, `consecutive_failures` and `properties.net` to Web PowerSync and network records. Verify with tests for each phase, both counters, ray presence versus absence, and net presence versus absence.
- [ ] 3.3 Add exponential reconnect backoff (5 s to 120 s), offline pause and immediate online/foreground reconnect to `apps/web/app/plugins/powersync.client.ts`, with one schedule in shared-worker mode. Verify with tests for the delay sequence, reset on success, offline pause, immediate resume and unchanged upload order.
- [ ] 3.4 Emit `powersync_phase` and `powersync_connection_lost` from the Web first-party sender with the mapped phase names, durations, and the error fingerprint and ray on failures. Verify with tests for token, connect, stream, upload/submit/acknowledge, and a failure that joins to its error record.
- [ ] 3.5 Read `userStore.userInfo.userId` on `/x/ext-bridge` as the collector's user source, add `properties.surface=ext-bridge`, and never read the bridge payload or a token. Verify with tests for a signed-in store, an empty store, and a conflicting bridge payload.
- [ ] 3.6 Exercise a local Web build against the test endpoint and API: an API 500 with ray and `properties.net`, a network failure, a PowerSync stream failure with backoff, an offline pause and resume, a telemetry phase event, a blocked GTM script, a Stripe script failure and an ext-bridge error with a user. Record the evidence and gaps in `validation.md`.

## 4. Mobile

- [ ] 4.1 Add the `@commons/frontend-utils` workspace dependency and the typed `MobileErrorLog` port, implemented under `src/telemetry/` with a Mobile sender and guarded creation. Verify typecheck, the bundle, and tests for a no-op fallback and a never-throwing capture.
- [ ] 4.2 Install `ErrorUtils`, release-only Hermes rejection tracking and root-boundary `componentDidCatch` capture; cache the device id, read the user id synchronously, and maintain `properties.screen`. Verify with tests for handler chaining, fallback UI, identity binding and parameter-free screen names.
- [ ] 4.3 Capture PowerSync `token`, `connect`, `stream` and `upload` failures once with `online`, `foreground`, `phase`, `connection_ms`, `consecutive_failures`, `stage=init` and `properties.ray` where a response exists. Verify with tests for each phase, one record per failure, and a healthy sync producing none.
- [ ] 4.4 Capture failed Mobile API requests with 5xx/network filtering, method, path, status, ray and context. Verify with tests for 500, 404, abort, retry-then-success, offline and sync-request exclusion.
- [ ] 4.5 Reuse `syncFailures`, `syncRetry`, `clearSyncRetry` and `connectAccount` for the 5 s–120 s reconnect backoff, reset on connected status, and keep the existing offline/online/foreground paths. Verify with tests for the delay sequence, reset, offline pause, immediate resume and one pending timer.
- [ ] 4.6 Widen the Mobile event property type and emit `powersync_phase`/`powersync_connection_lost` with mapped phases, durations, fingerprint and ray on failures. Verify with tests for the phase mapping, numeric durations and join keys.
- [ ] 4.7 Add the `EXPO_PUBLIC_SLAX_CLIENT_ERROR_INGEST_URL` build input, empty by default in development and set for production builds. Verify `pnpm mobile -- config`, the bundle, and a unit test that an empty endpoint sends nothing.
- [ ] 4.8 Exercise a development build against the test stream and API: uncaught error, rejection, render error, API 500 with ray, PowerSync upload and stream failures, backoff, offline pause and resume, and a telemetry phase event. Record the evidence and gaps in `validation.md`.

## 5. Operator infrastructure and cross-app verification

- [ ] 5.1 Have the operator create the test and production Mobile streams and pipelines that insert into the existing `client_errors_sink`, and confirm Mobile and Web rows land in `client_errors.errors` with the Mobile `page_url` NULL and the numeric `user_id` rule. Verify valid and invalid admission cases, including `app=web`, non-NULL `page_url`, wrong `env`, unknown `kind`, a non-numeric `user_id` and oversized fields.
- [ ] 5.2 Confirm the PowerSync hostname Transform Rule exposes `cf-ray` and `Timing-Allow-Origin`, that the API exposes both headers, and that the Reader event lake accepts the new event names and numeric properties. Record the operator follow-ups in `validation.md`.
- [ ] 5.3 Record in `validation.md` that no UI is visible, so `DESIGN.md` §10.1/§10.2 checkpoints do not apply, and that the Extension is not modified.

## 6. Delivery

- [ ] 6.1 Run `pnpm exec openspec validate --all --strict`, the API, Web and Mobile checks named in `validation.md`, and lint on touched files; record every command and result.
- [ ] 6.2 Run the `REVIEW.md` local pre-push review (Bugs, Security, Compliance) and fix every Important finding.
- [ ] 6.3 Ask the change requester for the Mobile `version`/`buildNumber` decision and the `frontend-error-logs` archive sequencing; apply the answers.
- [ ] 6.4 Open one pull request against `dev` with the repository template body linking `validation.md`, and hand the monitor event migration to its owner.
