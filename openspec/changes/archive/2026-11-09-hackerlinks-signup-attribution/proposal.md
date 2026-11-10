# Proposal

## Why

HackerLinks already links to Reader with `utm_source=hackerlinks`, `utm_campaign=mvp`, and `utm_medium=header|resource_detail`, but Reader drops that context before the server writes `user_created`. We need a trustworthy count of newly created Reader accounts attributed to those links without integrating the two account systems or importing HackerLinks telemetry.

## What Changes

- Preserve only a fully valid HackerLinks UTM triplet through the existing unauthenticated `/` → `/login` redirect, the Google or Apple OAuth `state`, the `/auth` callback, and the existing optional `auth_attribution` member of `POST /v1/user/login`.
- Reuse the server-written `user_created` event. Add exactly `source=hackerlinks`, `medium=header|resource_detail`, and `campaign=mvp` after a new account is confirmed, following the analytics handbook's existing domain-entry attribution rule; keep the server-selected `method=google|apple` and authenticated `user_id`.
- Cover both existing Web OAuth providers. Do not add acquisition fields to `user_logged_in`, create a client success event, or change the existing collection-attribution behavior.
- Validate the optional attribution at the API boundary as a closed contract. Missing, partial, malformed, or unsupported attribution is omitted without failing otherwise valid authentication; unknown keys never reach the event.
- Add a narrowly scoped HackerLinks registration question, event-property definitions, a deterministic warehouse query, and a superseding decision in `slax-reader-event-tracking`. The previous Q1 “no channel attribution” decision remains valid for the activation funnel except for this explicitly approved acquisition count.
- Verify the real Web → OAuth provider → callback → account creation → `logs.events` path with authorized test accounts before treating the attribution as live.

## Capabilities

### New Capabilities

- `signup-acquisition-attribution`: Preserve a minimal acquisition triplet across Web OAuth and attach it only to the server-confirmed account-creation fact, with bounded collection and reproducible reporting.

### Modified Capabilities

None. Existing collection conversion requirements and behavior remain unchanged; this change introduces a separate attribution contract rather than broadening the collection funnel.

## Impact

- Web: the global unauthenticated redirect, login view, Google and Apple controls, OAuth helpers, callback parsing, and focused tests.
- API: additive optional attribution parsing on `POST /v1/user/login` and property selection for the existing `user_created` writer. Login responses, credential handling, redirects, account lookup, and alias authority remain unchanged.
- Shared contracts: a narrow acquisition-attribution type composed with the existing collection type; no new endpoint or event name.
- Analytics: companion changes in `slax-reader-event-tracking` to the current dictionary, Q1 scope, a new HackerLinks tracking plan and decision record, and navigation. The frozen `specs/tracking-plan-新用户激活.md` remains a historical snapshot; the new decision explicitly supersedes its old channel-attribution scope.
- Data boundary: Reader writes only its own `logs.events`. No read from or write to `hackerlinks_events`, no cross-dataset join, and no HackerLinks page-event implementation.
- No database schema, event-store schema, dependency, account-system integration, or visible UI change is proposed. Web/API shipping-impact and application-version review is required before implementation handoff; CLI, Extension, and Mobile are unaffected.

## Non-goals

- A general multi-touch or all-channel attribution framework, HackerLinks click-to-registration conversion rate, cross-device identity, or retrospective attribution of historical users.
- Collecting `utm_content`, HackerLinks draft/staged content, resource IDs or URLs, full landing/redirect URLs, referrers, OAuth credentials, email addresses, or a new visitor identifier.
- Changing `user_device_alias`, signup-retrospective/login-forward merge rules, operational `user_logs`, GA4/GTM, OAuth security, account deletion, or the HackerLinks website.

## Approval status

Approved by Alex on 2026-11-06 after the review revisions: complete-triplet reporting, existing `source` under handbook A3, normative `effective_at`, and the narrowed Q6 decision purpose. Implementation of the approved application and companion analytics changes is authorized. Deployment, real test-account creation, warehouse acceptance, and production operations still require the environment-specific authorization stated in design.md.
