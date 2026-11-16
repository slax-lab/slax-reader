# Proposal

## Why

Starred collections currently behave as an opt-in sharing feature: a user must discover the entry, meet the starred-count threshold, and complete an enablement form before receiving a shareable public page. The product instead defines starring as public curation and the collection as a permanent public view that every user already has, so enablement adds a separate mental model and interrupts the path from noticing a collection to sharing it.

## What Changes

- Give every active user a starred collection by default, with a stable public `/c/<code>` address, an automatically generated default name, and no enablement step.
- **BREAKING:** Provision an open collection for users who do not have one, without user notification, an advance opt-out flow, or a visibility confirmation.
- Preserve every existing collection's current visibility, including collections previously closed by their curators. Existing collection codes, public addresses, and user-selected open or closed status remain unchanged during rollout and ordinary provisioning.
- Treat saving and starring as different product actions: saving remains private, while starred items automatically appear in the owner's public collection and unstarred items disappear from it.
- Replace the Web enablement prompt and form with an always-available collection summary and direct copy/share action. Remove the 10-star discovery threshold and make the entry available on narrow Web viewports.
- Add a lightweight, non-blocking first-star discovery cue on Web. Its purpose is to introduce the collection and offer a path to view it, not to disclose or confirm public visibility, and it must not interrupt starring.
- Keep collection name, description, link management, and manual close/reopen controls after rollout. Collections closed before or after rollout remain closed until their owners explicitly reopen them.
- Allow direct access to an empty public collection with an appropriate empty state.
- Preserve the existing public collection subscription and sharing flows, including their analytics behavior.

## Capabilities

### New Capabilities

- `starred-collection-sharing`: Default provisioning and visibility of starred collections, direct discovery and sharing, first-star collection discovery, empty-collection behavior.

### Modified Capabilities

None. No living capability currently owns starred-collection visibility or enablement. The active `track-collection-conversion` change owns the separate `collection-conversion-analytics` capability; this proposal does not alter its event definitions or reporting requirements.

## Impact

- API and database: default collection creation during registration, a one-time backfill for existing active users, read-only owner collection information, and stable code generation.
- Web: starred-library collection entry, enablement modal removal, first-star discovery cue, collection management wording and state handling, empty public collection presentation, localization, and related tests.
- Public content: existing collection URLs, snapshot-to-collection attribution, and subscription entry points.
- Verification: registration and backfill fixtures, migration idempotence and visibility preservation, API and Web tests, running-environment checks, and human hands-on acceptance of the visible Web changes.

## Scope Decisions

- The change requester explicitly rejected a first-public-share confirmation, first-star public-visibility disclosure, and advance provisioning notification.
- The change requester decided that users without a collection receive an open collection by default, while every existing collection preserves its current visibility, including prior curator-closed status.
- On 2026-11-11, the change requester chose registration-time creation plus a one-time backfill for existing users. The implementation does not create collections on star writes, does not make collection settings local-first, and does not create collections in `GET /mine`.
- The change requester decided to leave collection sitemap eligibility unchanged, so its existing minimum-star threshold stays as it is.
- The change requester decided that an unavailable local starred count may show the discovery cue once per account and browser rather than delaying star feedback; a known nonzero count still suppresses it.
- This proposal changes Web discovery and management surfaces. It does not introduce a new native-mobile collection management interface; the API visibility and provisioning rules apply independently of client.
- Per-bookmark visibility controls, private starring, multiple collections per user, and a redesign of collection subscriptions are outside this change.

## Demo Approval

On 2026-11-09, the change requester reviewed the temporary requirements-discovery demo and approved the resulting interaction requirements for implementation. The demo covered the direct-share flow, empty/open/closed collection states, the first-star cue, and desktop 1200px, 768px, and narrow 320px presentations in light, dark, and e-ink themes. The requester's feedback changed the first-star cue from a top-centered global Toast to a non-blocking bubble anchored near the triggering star control. The cue replaces the ordinary star-success feedback and remains for about four seconds. Its public-page navigation was superseded by the follow-up demo's starred-list navigation. The cue falls back to the global Toast only when anchoring is unavailable. Demo approval authorizes implementation only; post-implementation hands-on acceptance remains required.

## Follow-up Demo Approval

On 2026-11-10, the change requester reviewed a lightweight two-frame demo for first-star orientation and approved it for implementation. The approved cue offers “去星标页看看” rather than opening the public collection directly. It leads to the starred bookmark list, where the collection area explains that stars automatically form a recommendations page with a shareable link. This establishes the collection's purpose and permanent entry without restoring an enablement step or forcing a public-page visit. Post-implementation hands-on acceptance remains required.
