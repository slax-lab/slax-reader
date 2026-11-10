# Design

## Context

See [proposal.md](proposal.md) for motivation and [the capability delta](specs/signup-acquisition-attribution/spec.md) for the behavior contract.

Code baseline: `slax-lab/slax-reader` commit `d50171f9278547c407b810d271473623e7d7d746` (`origin/dev` when this worktree was created). Analytics baseline: `slax-lab/slax-reader-event-tracking` commit `92011d769f18f662f8434a8019ecd5576ebf1904` on `main`.

Observed implementation seams:

| Surface | Current behavior and implication |
| --- | --- |
| Initial auth redirect | `apps/web/app/middleware/auth.global.ts:45-56` redirects unauthenticated entries to `/login` with only `redirect`; the three UTM values must survive this hop explicitly. |
| Login controls | `apps/web/app/pages/login.vue:20-23` reads return/affiliate inputs; `components/global/LoginView.vue:20-24` renders Google and conditionally Apple. Supporting only Google would undercount HackerLinks registrations. |
| Google OAuth | `components/GoogleLoginButton.vue:34-57` and `composables/useAuth.ts:12-31` already accept collection attribution and put it in per-attempt JSON `state`. |
| Apple OAuth | `components/AppleLoginButton.vue:27-40` and `useAuth.ts:33-51` have the same state carrier but no attribution parameter. |
| Callback | `apps/web/app/pages/auth.vue:34-45,76-88` validates a collection-only state fragment and calls `grantAuth`; `useAuth.ts:67-77` currently forwards attribution only for Google. |
| API boundary | `apps/api/src/domain/user.ts:43-52,712-735` validates collection attribution, authenticates, then writes `user_created` or `user_logged_in` through `submitServerEvent`. This is the correct single success writer. |
| Account creation | `apps/api/src/domain/user.ts:239-320` determines `isFirstRegister`, writes the user, binds the provider, creates the session, and returns `is_new_user`; attribution cannot determine this result. |
| Identity | `apps/web/app/utils/request.ts:90-123` reuses or creates `_su` and sends `X-Device-ID`. `apps/api/src/domain/user.ts:311,323-327` binds that device after the account write; `domain/events.ts:73-105` uses the same request context for the server event. |
| Collection precedent | `packages/contracts/src/events.ts:3-9` and `apps/api/test/domain/collectionAuthAttribution.test.ts` provide a narrow type, closed validation, unknown-key stripping, and fail-open analytics tests to reuse without changing collection semantics. |
| Analytics authority | The analytics registry currently ends at Q5. `handbook/03-事件词典.md:48-57` defines `user_created`; both current and frozen Q1 plans exclude channel attribution, while README declares the frozen `specs/` files historical snapshots. |

The supplied HackerLinks links and UTM values are taken as fixed inputs. No HackerLinks implementation change is needed.

## Goals / Non-Goals

**Goals:** Add the smallest additive transport and server-event change that answers the registration-count question for both Web OAuth providers. Make loss of attribution explicit, keep collection behavior compatible, and produce a query that needs only Reader's warehouse.

**Non-goals:** No persistent acquisition profile, general UTM framework, HackerLinks click funnel, identity redesign, OAuth security redesign, new analytics producer, or rewrite of a frozen analytics snapshot. No visible or accessibility-affecting UI change is intended.

## Decisions

### 1. Carry the triplet in URLs only until it enters per-attempt OAuth state

Add one Web helper with two closed mappings:

- Input: scalar `utm_source=hackerlinks`, scalar `utm_campaign=mvp`, and scalar `utm_medium=header|resource_detail`.
- Output: `{ source: 'hackerlinks', campaign: 'mvp', medium: 'header' | 'resource_detail' }` or `undefined`.

Reject arrays and all partial/unsupported combinations rather than selecting one value or guessing. Do not read `utm_content`, `referer`, the nested full return URL, resource parameters, or page content.

At `auth.global.ts`, copy the three original UTM parameters to the `/login` query only when the complete supported triplet is present; keep the existing encoded `redirect` unchanged. At the login page, parse those direct query values with the same helper and pass the resulting acquisition object through `LoginView` to the two provider controls. A direct `/login` URL with a valid triplet follows the same path.

Alternative rejected: `sessionStorage` or a global acquisition store. It would add persistence, cleanup, stale-source, and multi-tab questions to solve a hop that two explicit URL/state carriers already cover. Alternative rejected: parsing the full nested `redirect` URL at the login page; that obscures the contract and encourages full-URL propagation into analytics.

### 2. Compose acquisition with the existing attribution union, preserving provider rules

Add to `packages/contracts/src/events.ts`:

```ts
type AcquisitionAuthAttribution = {
  source: 'hackerlinks'
  medium: 'header' | 'resource_detail'
  campaign: 'mvp'
}

type WebAuthAttribution = CollectionAuthAttribution | AcquisitionAuthAttribution
```

Use a type guard keyed by the existing collection-only `source_screen`/`collection_id` shape. `GoogleLoginButton` emits its existing collection `element_clicked` only for collection attribution, never merely because acquisition attribution exists. `AppleLoginButton` accepts acquisition only. The collection modal remains collection-only.

Extend both OAuth state builders with the same optional `auth_attribution` member. The callback schema becomes a union of the existing collection schema and the acquisition schema, with invalid optional attribution recovering as `undefined` just as the current collection path does. Recovery buttons retain the validated union.

At `grantAuth`, forward either attribution shape for Google, but only acquisition for Apple. This preserves the existing test and product decision that collection conversion is Google-only while removing the current Google-only restriction for HackerLinks. No credentials, full URLs, or response fields are added to attribution.

Alternative rejected: a second `acquisition_attribution` request member. It would duplicate the callback/API contract and require two parallel validation paths for the same purpose. Alternative rejected: Google-only v1; it is smaller but cannot answer the unqualified registration-count question on a page that offers Apple.

### 3. Validate once at the API boundary and select properties by event/provider

In `apps/api/src/domain/user.ts`, define a closed Zod acquisition schema with three literal fields and a union with the existing collection schema. Zod object parsing strips unknown members. Parse at the existing `userLogin` boundary:

- Google accepts collection or acquisition attribution.
- Apple accepts acquisition only.
- Any missing/invalid required member omits that attribution without affecting authentication.

Keep the validated collection and acquisition values distinguishable internally. Spread the validated value into `user_created` exactly as the current collection path does. For `user_logged_in`, include only valid collection attribution under the existing rules; never include acquisition. Keep `method: result.login_type` outside the client object so it cannot be overridden. The API response remains unchanged.

No user table or persistent acquisition column is added. The registration fact already carries the authenticated positive `user_id`; that is sufficient for the requested count.

Alternative rejected: stamping `sr_user` or a new acquisition table. It would create a mutable dimension and migration for a question that an immutable account-creation event answers directly. Alternative rejected: attaching acquisition to both success events; it adds unneeded data and makes returning logins easy to miscount as registrations.

### 4. Reuse device identity only for continuity checks, not for the metric

No identity code changes are required. The existing login request interceptor sends `X-Device-ID`; `bindRequestDevice` writes `bind_source=signup|login` after account persistence; `createServerEvent` reads the same header. Runtime acceptance checks these behaviors and confirms alias continuity where available.

The primary query does not join `user_device_alias`, `sr_user`, or `hackerlinks_events`. A missing device remains a disclosed quality gap, not a reason to drop an otherwise valid registration or infer a person-level match. This preserves the existing signup-retrospective/login-forward policy without making this simple account count depend on cross-source analysis.

### 5. Add Q6 to the current analytics handbook and supersede the old scope by decision

Use the next available registry question, Q6: “有多少新注册用户来自 HackerLinks？” Its decision purpose is to provide a registration-contribution signal for HackerLinks continuation/stop decisions and to compare registration contribution by entry placement. This metric alone does not measure click efficiency, activation quality, or cost, and does not independently determine whether the MVP continues.

Companion analytics changes:

- `handbook/03-事件词典.md`: register Q6; add `source` (`hackerlinks`), `medium` (`header` / `resource_detail`), and `campaign` (`mvp`) as optional `user_created` event properties; set `answers_question` to Q1/Q6. Keep the single event-level lifecycle and server writer.
- `handbook/plans/Q1-新用户激活.md`: narrow the old “no channel attribution” statement so Q1 remains an activation plan while Q6 owns this registration count.
- `handbook/plans/Q6-HackerLinks注册归因.md`: define the complete-triplet metric, effective timestamp, UTC interval, fixed snapshot, natural-key deduplication, reconciled breakdowns, separate data-quality counts, and real-registration acceptance.
- `decisions/Q6-HackerLinks注册归因.md`: record the supersession of the old scope, the choice of existing `source` under handbook A3, rejection of a separate `acquisition_source`, closed fields, Apple coverage, metric decision limits, other rejected alternatives, approval, both code baselines, and companion PR links.
- `README.md`: navigate to the current Q6 plan and decision without duplicating definitions.

Do not edit `specs/tracking-plan-新用户激活.md`: README explicitly freezes it as a v1 historical snapshot. The new decision must name and supersede its old statement, while the current handbook carries the effective rule. Do not create an amendment appendix or a second dictionary.

The plan's primary logical query is:

```sql
WITH scoped AS (
  SELECT
    user_id,
    event_name,
    properties,
    occurred_at,
    device_id,
    CASE
      WHEN occurred_at IS NULL AND received_at IS NULL THEN NULL
      WHEN occurred_at IS NULL THEN received_at
      WHEN received_at IS NULL THEN occurred_at
      WHEN abs(epoch(received_at) - epoch(occurred_at)) > 300 THEN received_at
      ELSE occurred_at
    END AS effective_at
  FROM logs.events
  WHERE __ingest_ts >= :partition_start AND __ingest_ts < :partition_end
), ranked AS (
  SELECT
    user_id,
    event_name,
    properties,
    occurred_at,
    device_id,
    effective_at,
    row_number() OVER (
      PARTITION BY user_id, event_name, properties, occurred_at, device_id
      ORDER BY effective_at ASC NULLS LAST
    ) AS rn
  FROM scoped
), deduplicated AS (
  SELECT user_id, event_name, properties, occurred_at, device_id, effective_at
  FROM ranked
  WHERE rn = 1
)
SELECT COUNT(DISTINCT user_id) AS attributed_registrations
FROM deduplicated
WHERE event_name = 'user_created'
  AND user_id > 0
  AND effective_at >= :utc_start AND effective_at < :utc_end
  AND json_extract_string(properties, '$.source') = 'hackerlinks'
  AND json_extract_string(properties, '$.campaign') = 'mvp'
  AND json_extract_string(properties, '$.medium') IN ('header', 'resource_detail');
```

Natural-key deduplication intentionally covers the complete partition-scoped set before the UTC interval filter, retaining the earliest `effective_at`; an out-of-interval duplicate must not change interval membership. The executable plan must also state the snapshot binding, raw-versus-deduplicated row counts, a separate count of incomplete or unsupported attribution excluded above, and optional `GROUP BY medium, campaign, method` whose total reconciles to the primary metric. It must not present this count as HackerLinks UV, clicks, humans across devices, click efficiency, or a click-to-registration conversion rate.

### 6. Verify the real registration chain in two stages

Automated coverage is necessary but insufficient. Extend the existing Web and API suites for query extraction, initial redirect preservation, per-attempt Google/Apple state, callback parsing, login-body forwarding, API union validation, new/returning account branches, unknown-key stripping, identity/method non-override, and analytics failure isolation. Re-run existing collection attribution and auth recovery tests to prove no regression.

Then exercise the actual provider and warehouse path:

1. **Authorized non-production deployment:** use the real Web application, real OAuth providers, real `/v1/user/login`, and the configured event stream/warehouse destination. Use never-registered disposable provider accounts authorized for testing. A fixture-only callback does not satisfy this stage.
2. **Production C5 acceptance after deployment:** start from the actual public HackerLinks header and resource-detail links in clean browser profiles. Complete the same new-account matrix against production, then query production `logs.events`. Production account creation and warehouse acceptance require separate explicit authorization; do not infer it from proposal approval.

Minimum real-account matrix:

| Case | Entry and account | Required observations |
| --- | --- | --- |
| Google new registration | `header`, never-registered Google test account | `/login` retains the triplet; Google `state`, callback login body, `is_new_user=true`; one natural-key `user_created` with `medium=header`, `method=google`, correct positive `user_id` |
| Apple new registration | `resource_detail`, never-registered Apple test account | Same continuity with `medium=resource_detail`, `method=apple`; if Apple is disabled in the target environment, record the configuration and require this case where the provider is enabled before claiming complete provider coverage |
| Returning login | Reuse one attributed account | `is_new_user=false`; only `user_logged_in`; no acquisition fields and no increment to the registration count |
| Ordinary/invalid entry | Existing test account for runtime, new-account branch in automated tests | Authentication still succeeds; no attribution is submitted or stored for absent, partial, or unsupported values |
| OAuth cancellation | Cancel one provider authorization | Existing cancellation behavior and no success event |

For each successful new registration, inspect the actual callback request and the ingested event by `user_id`, not email. Event properties must be exactly the approved acquisition triplet plus `method` and existing `platform` / `locale` / `client_version`; assert the absence of `utm_content`, resource/staged content, resource or full URLs, referrer, OAuth credentials, email, and client-supplied identity. Check the same device's alias row has `bind_source=signup` when device identity is available.

Query at a fixed snapshot after ingestion settles. Record the snapshot, UTC window, raw rows, natural-key duplicates removed, deduplicated event count, and distinct users. Replaying or including duplicate deliveries must not change the result. Reconcile each created test account to exactly one deduplicated `user_created`; reconcile returning and cancelled attempts to zero new registration facts. Keep raw events, account identifiers, query exports, and screenshots out of the analytics repository; record sanitized evidence in the application change's `validation.md` and obtain Alex's C5 acceptance before `live`.

## Risks / Trade-offs

- Attribution is client-asserted and can be forged or stripped → Treat it as entry provenance, never security evidence; use closed values and do not infer missing values.
- Preserving only the initial `/` and direct `/login` paths leaves future entry routes uncovered → Add focused redirect tests and require future HackerLinks entry routes to opt in explicitly rather than introducing a global last-source store.
- OAuth state is visible to the browser and provider → Carry only three non-sensitive enum values; never add URLs, content, credentials, or identifiers.
- Apple has environment-specific availability and test-account cost → Cover it in code and require a disclosed real-provider acceptance gap rather than silently reporting complete provider coverage.
- Warehouse delivery is at least once → Deduplicate on the documented natural key, disclose raw duplicates, and verify count invariance.
- Historical or lost attribution cannot be reconstructed reliably → Start the metric at deployment and report unattributed registrations separately; do not backfill from HackerLinks URLs or device matches.
- Production test accounts add real registration rows → Obtain explicit authorization, keep their identifiers out of the analytics repository, and document any exclusion needed in later reports rather than adding a test-only event property.

## Migration Plan

1. Review and approve the application and companion analytics artifacts together, including both-provider coverage and the real-account acceptance cost.
2. Implement shared types and API validation/event selection first; deploy the additive API support before Web emits acquisition metadata. Existing callers remain valid.
3. Implement Web capture and OAuth propagation with focused regressions for ordinary and collection login. Update the current analytics dictionary/plan/decision with the implementation as linked companion changes; do not mark `live` yet.
4. Run the authorized non-production real-provider matrix, inspect actual ingestion, and resolve mismatches. Record all unavailable checks explicitly.
5. Deploy, run the authorized production HackerLinks-entry matrix, verify the fixed-snapshot query, obtain C5 human acceptance, and only then promote the affected dictionary lifecycle.
6. Roll back Web attribution emission if necessary; the optional API member remains backward compatible. Historical events remain immutable and are neither rewritten nor backfilled.
