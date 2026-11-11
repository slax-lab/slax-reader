# Proposal

## Why

A normal Inbox visit currently runs the KOC identity check even when no KOC URL or pending invitation exists. If that request fails, the shared KOC state enters `error`; the same state is then used to show a user-facing KOC warning, block automatic onboarding, and provide the account identity needed by bookmark readiness. This makes an unrelated KOC outage look like an onboarding failure and prevents previously synced local users from continuing offline.

The KOC promotion flow must remain recoverable when a user explicitly arrives through a KOC link, while ordinary product navigation must treat KOC transport failures as an absent promotion and continue using independently verified account and local-data state.

## What Changes

- Separate account context from KOC promotion state. Token-derived identity will scope local data only; a server profile will be the only source of server-authorized user identity.
- Scope durable pending KOC invitations by the local account key, while reading the existing numeric server-user-id key as a compatibility fallback when that verified ID is available.
- Define explicit local-data readiness for onboarding. A previously synced, owner-matched local database may support an offline empty-Inbox decision; a new, unowned, loading, failed, or stale database may not.
- Make KOC failures context-sensitive. Ordinary routes without a KOC query or pending invitation will fail silently, will not render KOC error controls, and will not block onboarding.
- Preserve retryable KOC errors for explicit KOC URLs and restored pending invitations, including Retry/Later behavior and claim-before-onboarding ordering.
- Move onboarding markers to a stable account namespace, keep compatibility with existing server-user-id markers, and isolate pending/dismissed state across account changes.
- Remove the dependency from bookmark readiness and empty-Inbox confirmation on the KOC state object.
- Keep the existing reward rules, claim API, database schema, route compatibility, root Inbox destination, and visual design unchanged.

## Capabilities

### New Capabilities

- `account-context`: A session-scoped account context that separates local ownership from server-verified identity and rejects stale account responses.
- `silent-koc-failures`: Context-aware KOC promotion failures that are silent on ordinary navigation and recoverable on explicit promotion journeys.
- `offline-onboarding-readiness`: Conservative, account-owned Inbox readiness that supports previously synced local data while refusing to infer emptiness from unavailable or failed data.

### Modified Capabilities

None. The existing KOC and Inbox onboarding behavior is currently represented by the in-flight `koc-onboarding-continuity` change rather than a living capability under `openspec/specs/`; this follow-up introduces narrower capability contracts for the remaining identity/readiness defect.

## Impact

- Web account/store/composable code, promotion flow utilities and host, bookmarks data and onboarding pages, onboarding marker storage, and unit/integration tests.
- No API endpoint or shared contract change is required. Existing `/v1/user/me`, promotion validation, and promotion status responses remain authoritative when explicitly requested.
- No database migration, reward-ledger change, subscription rule change, dependency addition, or Web/Extension visual theme change.
- Verification must cover ordinary API failure, explicit KOC failure, previously synced offline data, first synchronization, account switches, storage denial, and cached-page navigation.
