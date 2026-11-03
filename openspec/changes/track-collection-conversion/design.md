# Design

## Context

See [proposal.md](proposal.md) for scope and the human's selection of B. The requesting human approved this design for implementation on 2026-11-02; subscription conversion uses 48 hours and login diagnostics use 30 minutes.

Code baseline: `slax-lab/slax-reader` commit `cfd51f552327edfc9d23dc00e4b1d088ec955fb3` (`origin/dev` when the branch was created). Analytics baseline: `slax-lab/slax-reader-event-tracking` commit `e38ec3811ca255569c6adb8949def83e3c69858e`.

Observed seams:

| Existing surface | Evidence and implication |
| --- | --- |
| Public collection open | `apps/web/app/pages/c/[id]/index.vue:482-496` emits `collection_opened` on mount without checking unavailable-page states. Inbox also emits it at `apps/web/app/pages/bookmarks/index.vue:422`; `opened_from` is entry attribution, not destination surface. |
| Automatic UI tracking | `apps/web/app/plugins/first-party-analytics.client.ts:9-18,62-65` has no collection screen and rejects Google clicks outside route-derived `signup`. A modal does not change the underlying route. |
| Subscription intent | `SubscribeCollectionButton.vue:95-109` decides whether to show login or subscribe; `:132-164` resumes a pending subscription after login. Only the genuine button handler should emit a click. |
| Modal context | `components/Modal/index.ts:81` and `Modal/LoginModal.vue:48` currently accept only a redirect. The visible transition is at `LoginModal.vue:64`. |
| Google redirect | `GoogleLoginButton.vue:27` emits only a GTM login-start event. `useAuth.ts:10-28` constructs OAuth state; `pages/auth.vue:43-47` consumes it and performs the login exchange. |
| Authentication facts | `apps/api/src/domain/user.ts:714-720` emits `user_created` for first registration and `user_logged_in` otherwise. `:298,310-313` records device aliases. |
| Subscription fact | `apps/api/src/handler/http/collectionController.ts:80-81` emits `collection_subscribed` after orchestration. `domain/collection.ts:327-335` rejects an already-active relationship before creating the subscription. |
| First-party transport | `apps/web/app/utils/analytics.ts:11-38` posts to the configured API `/events` with `X-Device-ID`; server facts use `submitServerEvent`. Operational logs use a separate path. |

The analytics handbook's current dictionary owns event meanings. Its collection entries already cover Q2; its delivery chapter describes a same-origin Nitro proxy, while this checkout explicitly sends the device header to the API. This change reuses the existing functioning transport and requires end-to-end evidence; it does not silently claim the proxy exists or migrate transport as part of three requested metrics. Record that implementation discrepancy in the Q2 plan for a separate transport decision.

## Goals / Non-Goals

**Goals:** Provide attributable intent and outcome data using existing event names and a small optional metadata object. Preserve existing user operations when metadata or telemetry is unavailable. Give analysis a precise browser-level denominator and separate visitor, click, account, and subscription counts.

**Non-Goals:** See the proposal. In particular, this design adds no session framework, OAuth credential handling scheme, event uniqueness infrastructure, schema migration, retry system, or automatic attribution of every action after leaving the collection page.

## Decisions

### 1. Reuse canonical events and register only needed additions

The event-tracking repository's main event dictionary is the authority for field definitions and lifecycle. The following is the implementation mapping, not an alternative dictionary:

| Observation | Writer and event | Added/selected properties |
| --- | --- | --- |
| Usable public page opens | Client `collection_opened` | Existing `collection_id` and `opened_from`; add `surface=public_page` |
| Inbox collection opens | Client `collection_opened` | Add `surface=inbox` |
| Subscribe button activated | Client `element_clicked` | `screen_name=collection`, `element_id=collection_subscribe_button`, `collection_id` |
| Login modal becomes visible | Client `screen_viewed` | `screen_name=signup`, plus the four-field attribution below |
| Google activated in that modal | Client `element_clicked` | `screen_name=signup`, `element_id=login_google_button`, plus attribution |
| Authentication succeeds | Server `user_created` OR `user_logged_in` | Existing `method=google`, plus valid attribution |
| Subscription succeeds | Server `collection_subscribed` | Existing `collection_id`; no client success duplicate |

No extra `screen_viewed(collection)` is required merely to count opens. `screen_name=collection` registers the location of the button. Do not invent `collection_login_success`, `collection_subscribe_clicked`, or a second Google element name.

Alternative rejected: adding new GTM or legacy `/m` observations. The analytics handbook freezes GA4 maintenance and assigns new events to first-party collection.

### 2. Use explicit context for the public-page controls

Pass a narrowly typed optional analytics context from the collection subscription control through `showLoginModal` and `LoginModal` to `GoogleLoginButton`. Emit modal exposure when it actually becomes visible, once per opening. Keep context on that modal instance, not in a global last-visited collection variable.

For the contextual Google activation, use an explicit first-party call before OAuth navigation. Keep the global listener's existing behavior for normal login routes; it already excludes the `/c` modal. Do not broaden global route tracking just to implement these observations. Verify exactly one click submission and unchanged standalone-login tracking.

Emit subscription intent in the actual user-activation path before asynchronous user lookup, not in `doSubscribe`, which is also called by automatic resumption. Keep existing busy guards and do not change subscription behavior to satisfy analytics.

Public-open reporting must observe successful content readiness for the current collection, whether initial SSR hydration or SPA entry. Use a per-page-entry/current-collection guard; rerenders and pagination are not new entries. A different collection, navigation away and back, or reload is a new entry. Keep the existing `opened_from` values, and add `surface` at both public and Inbox call sites. A missing/closed/error page is not a usable content open; old request logs remain available for delivery failures.

Alternative rejected: relying only on existing `data-analytics-element` markers. The collection route and modal context are absent from the global mapping, and that listener does not currently attach a collection ID.

### 3. Carry attribution through the existing Google exchange

The optional request addition is:

```json
{
  "auth_attribution": {
    "collection_id": "ExampleCollection123",
    "source_screen": "collection",
    "presentation": "modal",
    "trigger_element_id": "collection_subscribe_button"
  }
}
```

This is an additive fragment of the existing `POST /v1/user/login` body, not a new endpoint or complete request example. Existing OAuth credential fields, method selection, response shape, auth failures, and callers without attribution retain their contract.

- Web: include this optional object in the existing Google OAuth state for the initiating modal only; preserve `target`, `redirectUrl`, `affCode`, and `platform`. The existing callback passes it to the login exchange. Do not add source details to the redirect target or store a global persistent last-source value.
- API boundary: during existing login-body parsing, accept the object only when its required members match the closed contract. `collection_id` uses the existing public alphanumeric code, length 1–64. The other three values are fixed as above. Strip unknown members; omit the whole attribution when a required member is invalid. Attribution is only applied to Google collection-origin flows in this change.
- Internal flow: propagate the validated value alongside authentication context or internal results; do not reread a consumed request body or put metadata in the external login response.
- Event: after successful authentication, flatten the four approved members into existing success-event `properties`, keeping the server-selected `method` and authenticated `user_id`. A new account produces `user_created`; a returning account produces `user_logged_in`, not both.
- Metadata omission or invalidity never turns otherwise valid authentication into a failure. Actual credential/auth failures keep their existing behavior and emit no success. Analytics transport failures do not change the login response.

The attribution is client-asserted provenance; it is not cryptographic proof that a human saw a page. Identity and successful authentication remain server-confirmed. Do not use attribution to authorize a redirect, access a collection, infer an account, or alter subscription rights. No credential, full URL, email, raw UA, or duplicate identity field belongs in this object.

Alternative rejected: generating a new client login-success event. That duplicates the server writer and can miss or misstate account creation. Device/time-only matching remains useful for diagnosis but does not replace explicit collection provenance.

### 4. Reuse identity and report bounded browser cohorts

Continue using `_su` through `X-Device-ID`, and let the backend determine `user_id`. Do not add `is_logged_in`; the event-time value is derivable. Keep alias writes and signup-backward/login-forward rules unchanged.

Detailed metric definitions live in the approved Q2 tracking plan. Approved windows:

- Browser UV: distinct nonempty `device_id`, per collection and requested interval. This approximates visitors, not cross-device humans. Reloads increase opens, not UV.
- Modal diagnostics: ordered events for the same collection and device within 30 minutes of modal exposure. Valid attributed Google successes are `user_created` or `user_logged_in` with `method=google`. Multiple attempts may exist; report distinct browser UV separately from event counts. The interval is a query rule, not a persisted session.
- Q2: anonymous (`user_id=0` at entry) public-page browsers whose first qualifying cohort visit in the interval is followed by `collection_subscribed` for that device and collection within 2 days (48 elapsed hours, independent of calendar-day boundaries). Later ordinary activity is not retroactively assigned to a user merely because they logged in. Reports also show authenticated account counts separately.
- Report all-public and anonymous-only raw subscribe-click UV separately. These raw identity cuts can overlap. Authenticated users have a direct subscribe branch and are not required to traverse the modal funnel.
- Click-to-subscription is a separate cohort metric: after delivery deduplication and data-quality/bot filtering, take each device/collection's first eligible public subscribe click in `[start, end)`, requiring an earlier or simultaneous usable public open for the same device/collection within that interval. Missing opens remain an unmatched-click diagnostic and do not enter this rate. Click identity must be 0 or positive; fix the branch from that first click's original `user_id`. Later login or clicks neither reclassify nor restart it.
- At the data-complete observation cutoff `T`, include only anchors with `click_time + 48h <= T` in both numerator and denominator, even if immature anchors already converted. A qualifying server subscription has positive `user_id`, the same device/collection, and time in the inclusive `[click_time, click_time + 48h]` range. Count each anchor once; return unavailable for a zero denominator. Branch cohorts are mutually exclusive, unlike raw click UV cuts. Account counts remain separate, and this browser metric does not require matching the click and success account IDs.
- Delivery deduplication follows the warehouse's existing natural key before aggregation. Exclude recognized bots using collected UA; classify missing identities/attribution as gaps, not guessed matches. No retrospective inference of `surface` from `opened_from` on legacy records.

Existing request helpers establish the identity. Runtime acceptance must verify that the initiating public page and the configured authentication callback retain the required browser identity across the actual deployed origins. If identity continuity is unavailable, report collection-attributed server success counts separately and mark the browser-conversion result unavailable; do not claim a joined funnel passed. Changing auth origins or introducing cross-domain identity transport is outside this proposal.

### 5. Coordinate two reviewable repositories

- Application change: `track-collection-conversion`, capability `collection-conversion-analytics`; no overlapping `web-login-modal` delta with the presentation change.
- Event-tracking companion: integrate current event properties, enums, and carriers into the main tables of `handbook/03-事件词典.md`; keep formulas, coverage, and acceptance in `handbook/plans/Q2-collection-conversion.md`. Keep approval history, code baselines, evidence references, and change rationale in `decisions/Q2-合集订阅转化.md`. README navigates to both Q1 and Q2.
- Maintain only the C3 event-level lifecycle in the main dictionary. The six verified event writers are `implemented`; property/platform/carrier coverage belongs in the plan, without another status vocabulary. No event is promoted to `live` before C5 warehouse evidence and acceptance. Current definitions must not be duplicated in an amendment appendix.
- Application and analytics PRs are linked parts of the same approved change. Respect each repository's base branch; publish implementation and documentation as companion drafts with verification gaps disclosed. The analytics repo is for definitions and plans, not raw events, sample user data, credentials, or query-result exports.

## Risks / Trade-offs

- Browser observation misses visits where JavaScript never runs → call the primary metric usable public-page browser opens, not external link clicks or HTTP requests; preserve operational request logs separately.
- Existing `eventLog` does not inspect non-2xx responses or retry → verify actual warehouse delivery, not just a successful component test. A general delivery rewrite is not bundled here.
- The warehouse can redeliver records → use documented natural-key deduplication and report removed rows; no new event-ID subsystem.
- Shared Google/modal components have other callers → optional context only, regression checks for ordinary login, Apple availability, and unchanged redirect behavior.
- Source attribution cannot prove account ownership or survive arbitrary identity loss → use server identity, retain event-time anonymity, and disclose unjoined records.
- The approved 30-minute and 48-hour windows and their distinct anchors affect results → label each report and keep incomplete cohorts separate.
- An active login-modal presentation change touches the same component → preserve its markup and lifecycle, resolve source conflicts without parallel capability deltas.

## Migration Plan

1. Review these artifacts and the companion dictionary/plan locally. Record the approved field definitions and metric defaults before implementation.
2. Implement the additive backend contract and tests, then the Web instrumentation. Deploy backend support before the client metadata. Other callers remain valid throughout.
3. Exercise anonymous new-user, anonymous returning-user, cancellation/failure, authenticated subscribe, and post-login auto-subscribe paths in an authorized running environment. Confirm actual events, fields, device continuity, writer ownership, and duplicate handling in `logs.events`.
4. Apply the Q2 plan's controlled-flow acceptance checks: complete required fields, stable nonempty device identity, disclosed raw duplicate rate with deduplicated invariance, and one-to-one reconciliation of business outcomes against success events. Record sample counts, snapshot, time ranges, discrepancies, and unavailable checks. Record evidence in this change's `validation.md`; keep raw data out of the analytics repository. Mark only verified dictionary entries live after the required human acceptance. Missing live access is an explicit gap, not a live status.
5. Rollback the new client observations/attribution if needed; the server's optional field remains compatible. Do not delete historical warehouse events or rewrite legacy Dashboard queries. Retire live definitions only through the handbook's deprecation procedure.

No production deployment, real account registration/subscription, or warehouse query is implied by the local implementation and fixtures. The 2026-11-03 follow-up is limited to documentation and query verification; shipped application behavior is unchanged.
