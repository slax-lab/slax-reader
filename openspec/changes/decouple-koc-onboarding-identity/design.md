# Design

## Context

See [proposal.md](proposal.md) for the motivation. The current implementation mounts `KocPromotionHost` globally on the default layout, stores server `userId` and local `sessionOwner` together in the KOC state, and lets bookmark readiness read that state. `promotionBlocksOnboarding()` treats `error` as blocking regardless of route context. `useBookmarkData()` therefore cannot distinguish an API outage from an unverified account or an empty local Inbox.

The existing PowerSync plugin already exposes a token-derived owner namespace and a `hasSynced` status. Existing onboarding tests cover first-load and marker behavior, but they currently inject the KOC state as the identity source. The fix must preserve the completed KOC continuity behavior while introducing a separate trust boundary for ordinary onboarding.

## Goals / Non-Goals

**Goals:**

- Give bookmarks/onboarding a stable account context independent of KOC request success.
- Let previously synchronized, correctly owned local data support offline onboarding.
- Make ordinary KOC failures silent and non-blocking.
- Keep explicit KOC journeys retryable and claim-before-onboarding.
- Prevent stale identity, local-query, storage, and route responses from crossing account boundaries.
- Keep API contracts, reward economics, route compatibility, and visual styles unchanged.

**Non-Goals:**

- No new server-side pending-invitation table or cross-device invitation recovery.
- No change to the promotion grant transaction, eligibility rules, subscription stacking, or Turnstile behavior.
- No replacement of PowerSync synchronization or REST bookmark loading.
- No redesign of the KOC modal, onboarding tutorial, or Web theme.

## Decisions

### 1. Introduce a typed account context rather than expanding KOC state

Create pure helpers in `apps/web/app/utils/accountContext.ts` and a shared `useAccountContext()` composable. The context contains:

```ts
export type AccountContext = {
  accountKey: string | null
  sessionOwner: string | null
  serverUserId: number | null
  source: 'server' | 'local' | null
  status: 'empty' | 'local' | 'ready' | 'stale'
  generation: number
}
```

`accountKey` is derived from the current token only for browser/database namespacing. It is an opaque stable digest of the token identity claim; raw JWTs and raw email addresses are never persisted in marker or promotion keys. `serverUserId` is committed only by a current-session server profile read. If that read later fails for the same token, the server ID is cleared for server-dependent operations while the local context remains usable. `generation` and the token captured by each read guard late responses. The user store owns server-profile refresh; KOC consumes the context but does not become its owner.

Alternatives considered:

- **Keep `userId` in KOC state and hide errors:** rejected because ordinary bookmark readiness still depends on an unrelated request and cannot work offline.
- **Use the decoded JWT ID as the server user ID:** rejected because decoding is not signature verification and the existing API uses a different ID context.
- **Use only the server profile:** rejected because a previously synced local database must remain addressable while the API is down.

### 2. Make local and REST readiness explicit

`useBookmarkData()` will consume `useAccountContext()` and expose readiness based on the active data source:

- Local tabs require `status` of `local` or `ready`, matching `accountKey`/`sessionOwner`, `hasSynced === true`, no query error/fetching/loading, and a direct committed empty check before `confirmOnboardingEmpty()` returns true. A same-token API failure keeps the context `local`; it does not downgrade safe local readiness to an unusable server state.
- REST tabs require a successful response for the current token and matching `serverUserId`; a failed request leaves `restReady` false.
- The KOC state is removed from this decision entirely.

`useInboxOnboardingState()` remains the audience gate for active personal Inbox, extension detection, subscriptions, and dismissed state. It receives the independent readiness and confirmation result; it never infers empty from an error.

Alternatives considered:

- **Treat an empty live query as enough:** rejected because first synchronization can still be incomplete and notifications can be throttled.
- **Always fall back to REST:** rejected because the exact outage scenario must work from previously synchronized local data.
- **Trust cached profile data:** rejected because it can belong to a prior token or account.

### 3. Add an explicit promotion-context predicate

Add `hasPromotionContext(state, routeQuery): boolean` and change `promotionBlocksOnboarding(state, hasContext, contextResolved): boolean`. Add a reactive `contextResolved` flag to the shared promotion state. Context is true for an explicit `activity_type=blogger` query, a restored pending invitation, or an active claim/success acknowledgement. Ordinary routes with no pending invitation are context-free only after invitation restoration has completed.

The controller will restore the account-key pending record as soon as the local account key is available, without waiting for `/v1/user/me`. It will set `contextResolved` immediately after that bounded local restore. A context-free identity failure then becomes an inactive/idle state; it never remains an error that blocks onboarding. Explicit KOC URLs still wait for verified server identity before validation/claim, while ordinary onboarding can proceed after local pending restoration when no pending invitation exists. The host will render checking/error controls only when context is true. Explicit KOC failures retain the current pending invitation and Retry/Later behavior. This preserves claim ordering without making ordinary onboarding wait for a KOC API timeout or letting onboarding race pending restoration.

Alternatives considered:

- **Hide only the host's error message:** rejected because the gate would still block onboarding.
- **Never run KOC checks on ordinary routes:** rejected because stored pending invitations must still be restored and checked on ordinary visits.
- **Treat every error as Later:** rejected because it silently loses explicit KOC recovery affordances.

### 4. Version onboarding marker storage while preserving compatibility

Change `useOnboardingPending()` to accept account context or its legacy numeric-ID input. New markers use a stable account-key namespace such as `slax_onboarding_pending_v2_<accountKey>` and `slax_onboarding_dismissed_v2_<accountKey>`. When `serverUserId` is available, read the existing numeric keys as a compatibility source and mirror the resolved state into the new namespace. Persist a non-secret account-key-to-server-ID alias when a profile is verified, so a later offline startup can still read legacy numeric markers without trusting a stale profile as server identity. Dismissed always wins and removes a stale pending value. No raw token or email is written.

Pending KOC invitations use the same local account namespace in a new versioned key. The existing numeric KOC key remains a read/delete compatibility path when a current verified server ID or a previously persisted non-secret account alias resolves it. The alias is storage compatibility only; it cannot authorize a claim or make a failed identity request succeed. This allows a same-token API outage to restore a deferred invitation without treating a stale server ID as authoritative.

Storage read/write failures preserve the current in-memory state for the active account; they never make an unknown account look pending.

### 5. Keep API behavior additive and unchanged

No backend or contract change is required. `/v1/user/me` remains the only server identity source, and existing KOC validation/status/claim endpoints remain authoritative only for explicit KOC context. The implementation must not reinterpret a failed request as eligible, already received, or empty data.

## Risks / Trade-offs

- **Local data can be stale while offline** → require prior `hasSynced`, current owner equality, successful queries, and a direct committed empty check; never use a new or unowned database.
- **Legacy onboarding markers may be stranded** → read numeric markers when the server ID is verified and mirror them into the stable namespace before writing new state.
- **A pending KOC invitation may keep an explicit route blocked during a long outage** → preserve Retry/Later, keep ordinary no-context visits silent, and allow the user to defer explicitly.
- **Concurrent account changes can create cross-account UI races** → guard every async commit with token plus generation checks and close/clear presentation on session change.
- **Storage denial removes durable recovery across a later bare URL** → preserve campaign parameters in the active route and onboarding return target; document that durable recovery requires storage.

## Migration Plan

1. Ship the Web change without changing API or database schema. Existing clients continue to use the current promotion endpoints.
2. On first use, read compatible numeric onboarding markers only after server identity is verified, then mirror them into the stable account namespace.
3. If the new Web build is rolled back, old numeric markers remain intact and the old KOC state can ignore the new keys; no reward or bookmark data is changed.
4. Validate with the existing Web suite, strict OpenSpec validation, and four browser scenarios: ordinary API-down, synced-local empty Inbox API-down, explicit KOC API-down, and retry after API recovery.

## Open Questions

None. The user has selected claim-before-onboarding, and the required behavior boundaries are fixed by the reported ordinary-route outage and offline empty-Inbox cases.
