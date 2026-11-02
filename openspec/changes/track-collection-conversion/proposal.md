# Proposal

## Why

The public collection page cannot currently distinguish visitors who see a sign-in modal, click Google, complete authentication, and subscribe. The analytics handbook already assigns this acquisition question to Q2, but the current client listener excludes `/c/[id]` and successful authentication events do not identify the originating collection.

## What Changes

- Adopt the approved direction B: measure both Google sign-in intent and server-confirmed authentication, alongside public collection opens and subscription clicks.
- Reuse `collection_opened`, `screen_viewed`, `element_clicked`, `user_created`, `user_logged_in`, and `collection_subscribed`; add registered properties and enum values rather than inventing parallel event names.
- Distinguish the public collection page from Inbox using an additive `surface` property on `collection_opened`. Count a usable page opening once; exclude failed, missing, and closed-page presentations from this conversion denominator.
- Record the sign-in modal when it becomes visible and the Google button on an actual click, carrying the collection and triggering control. Add a subscription-button click event before authentication branching; automatic post-login subscription is not another click.
- Carry optional collection attribution through the existing OAuth redirect, callback, and login request. Only the server adds that attribution to a successfully established new-user or returning-user authentication event.
- Prepare the analytics repository's event-dictionary amendment and Q2 tracking plan, including browser-UV definitions, time windows, duplicate handling, and warehouse acceptance evidence.

## Capabilities

### New Capabilities

- `collection-conversion-analytics`: First-party observation and attribution of the public collection acquisition flow, with separate intent and confirmed-outcome metrics.

### Modified Capabilities

None. No existing living capability owns this funnel. The active `login-modal-benefits` change owns `web-login-modal` presentation; this change does not carry a delta for that capability or change its UI behavior.

## Impact

- Web: public collection and Inbox collection-open call sites; subscription control; modal factory and modal; Google login control; OAuth helpers and callback.
- API: optional, additive analytics metadata on `POST /v1/user/login`, its runtime validation, and the existing server event construction. Login responses and identity authority stay unchanged.
- Shared contracts: the narrowly scoped attribution shape and event-property types, with existing callers remaining compatible.
- Analytics: local review branch in `slax-lab/slax-reader-analytics`; amendment to `handbook/03-事件词典.md`, new `handbook/plans/Q2-collection-conversion.md`, and a README review pointer. Cross-repository changes are linked companions, not a claim that one Git PR spans both repositories.
- No dependency, database schema, event-store schema, or application-version changes are proposed. Shipping-impact/version scope was checked before implementation handoff; the exemption is recorded in `validation.md`.

## Scope and Review Defaults

- The human selected B on 2026-11-02 and requested planning artifacts before implementation. The human approved the complete revised proposal for implementation on 2026-11-02, explicitly confirming 48-hour subscription conversion and 30-minute login diagnostics.
- Scope is `/c/[id]`. Its current direct modal trigger is the subscription button. A subsequent `/b/[id]` article interaction is outside this funnel until separately specified.
- Approved defaults: valid public-page browser UV; a 30-minute ordered modal-to-Google-to-authentication diagnostic window; and a 2-day (48-hour) anonymous-visit-to-subscription window for Q2. On 2026-11-02, the human requested shortening the original Q2 window to 1–2 days; the approved window is 2 days. These are elapsed reporting windows, not calendar-day boundaries, OAuth expiration, or a global session definition.
- No material or visible UX change is intended. Instrumentation preserves modal appearance, provider availability, routing, and automatic subscription. If implementation requires visible UX changes, follow `DESIGN.md` before extending the scope.

## Non-goals

GTM/GA4 changes or removal; migration of `user_logs` or existing Dashboard queries; a new dashboard; cross-device identification; paid collection behavior; OAuth security redesign; general retries/offline queues; Apple-specific funnel instrumentation; and rebuilding the collection/authentication UI.

## Approval and delivery

Approved by the requesting human in this conversation on 2026-11-02: proceed with this proposal, use 48 hours for subscription conversion and 30 minutes for login diagnostics. Approval covers the companion dictionary and Q2 plan. Implementation is authorized; live warehouse acceptance and deployment are separate evidence and delivery steps. No presentation or accessibility changes are intended. The prior documentation-only exemption applied only to planning; implementation requires the verification recorded in `validation.md`.
