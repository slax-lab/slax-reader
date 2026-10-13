# Proposal

## Why

An eligible returning user can enter a KOC link, be redirected into extension onboarding, and lose the invitation when that flow reloads the document. The reconstructed bookmarks page then selects the ordinary 30-day campaign, hiding the claim entry entirely if that campaign was already received; premature empty-list detection can send additional returning users into this path.

## What Changes

- Offer an eligible KOC reward before automatic onboarding, as selected by the user on 2026-10-13. Claiming remains explicit and subject to the existing production Turnstile check; choosing "Later" permits onboarding without discarding the invitation.
- Preserve a validated, account-scoped pending invitation across route transitions, KeepAlive activation, extension-install reloads, and later visits in the same browser. A fresh explicit KOC visit refreshes the current invitation; ordinary navigation does not replace it with the platform campaign.
- Use the existing root Inbox alias for KOC destinations (`/?activity_id=daguang&activity_type=blogger&claim=true`) and onboarding return navigation. Keep legacy /bookmarks links functional and preserve invitation context before cleaning the URL.
- Centralize promotion presentation and onboarding navigation so that eligibility checks, claim submission, success acknowledgement, deferral, and page activation cannot race each other.
- Add optional, backward-compatible eligibility reason and reward-description fields to the existing promotion status response. Preserve its legacy status boolean and all grant rules, including one reward across all bloggers, 60-day trials, Stripe credit, and active Apple subscription exclusions.
- Remove dependence on browser-global permanent activity_claimed_* flags and on forced page reload after claiming. Refresh subscription state and reconcile server status explicitly.
- Gate automatic onboarding on successful, current data resolution, including local-query readiness and first synchronization. Make completion flags shared and reactive across cached pages.
- Add regression coverage for the combined KOC/onboarding flow, including storage failures, account switches, slow responses, and repeated navigation.

## Capabilities

### New Capabilities

- `koc-promotion-continuity`: Recoverable account-scoped KOC claims, authoritative eligibility, and claim-before-onboarding behavior for new and returning users.
- `inbox-onboarding-readiness`: Reliable automatic onboarding decisions based on resolved Inbox data and shared per-account onboarding state.

### Modified Capabilities

None. The current living-spec inventory does not define either product flow.

## Impact

- Web invitation route, bookmarks and onboarding pages, promotion modal, default-layout flow host, promotion state utilities, bookmark data readiness, onboarding flags, and localized copy.
- API promotion status read path and shared contracts; no database migration, new reward ledger, authentication-policy change, or change to the reward-writing transaction.
- Existing unit and page integration tests plus browser verification of real route caching, reload, and asynchronous behavior.
- This change uses the Web design profile in the root DESIGN.md; it introduces no Extension theme or runtime changes.

## Non-goals

- Restricting KOC rewards to new registrations, changing ordinary/KOC stacking, changing Stripe or Apple grant policy, or automatically granting without confirmation.
- Synchronizing an unclaimed invitation between devices, reconstructing already-lost campaign attribution, changing commission rules, or backfilling rewards.
- Redesigning the extension-install tutorial, changing its Inbox-based audience to an account-wide bookmark-history rule, or replacing the authentication/logout work in progress.

## Review boundary

This change now includes implementation and regression coverage. The user authorized implementation after plan review on 2026-10-13. The reviewed scope includes session-bound identity, account-owned local readiness, safe storage-denied startup, and ordinary-modal compatibility.
