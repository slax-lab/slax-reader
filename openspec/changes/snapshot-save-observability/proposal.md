# Proposal

## Why

The public snapshot save journey has no first-party evidence for the visitor's first save activation, the sign-in that interrupts it, or the source snapshot of the later fork. The approved investigation concluded that the product should first measure this journey and accumulate a baseline before a separate change alters the post-authentication save behavior.

## Decision Provenance

This change implements the measurement half of Q7 in the separate `slax-reader-event-tracking` analytics repository, where the decision is recorded at `decisions/Q7-快照保存任务完成.md`. The Q7 decision defines the pair-level completion metric, the closed attribution fields, the `snapshot_save_button` and provider-click scope, and the pre-admission failure coverage that this change emits. The reference is repository-relative because the decision has no merged main-branch URL yet.

That repository requires its own branch and pull request for its handbook and decision update, and that pull request must land before this measurement change merges, so the metric definition exists before the events that feed it are deployed. This proposal does not restate the Q7 metric; the handbook and Q7 plan in that repository remain its authority.

## What Changes

- Add the existing Web detail-screen `element_clicked` observation for the snapshot save control as `element_id=snapshot_save_button`, carrying `source_bookmark_id` on both the anonymous first activation and the authenticated later activation.
- Add optional snapshot sign-in attribution with `source_screen=detail`, `presentation=modal`, `trigger_element_id=snapshot_save_button`, and `source_bookmark_id` to the existing sign-in modal view, Google and Apple provider clicks in the snapshot modal or `/auth` recovery page, the existing email code flow, Google and Apple OAuth state, the `/auth` callback, and `POST /v1/user/login`.
- Keep the sign-in modal attribution type limited to collection or snapshot contexts; HackerLinks remains on the standalone login-page transport. Validate `source_bookmark_id` as the same UUID format as `sr_user_bookmark.uuid` at the `/auth` and API login boundaries.
- Allow the existing `user_created` and `user_logged_in` facts to carry valid snapshot attribution for both newly created and returning accounts, including the email code path.
- Add `source_bookmark_id` to the existing `bookmark_saved` and `bookmark_save_failed` facts only when `POST /v1/bookmark/add_url` receives a trusted Reader `/b/<uuid>` snapshot URL. The target relation remains `bookmark_id`.
- Preserve existing collection and HackerLinks attribution behavior, visible save and login behavior, and ordinary-save event payloads.
- Keep automatic post-authentication saving outside this change; the separate `snapshot-save-auto-resume` change defines it. This is a scope boundary, not a permanent prohibition. Also exclude new event names, `save_kind`, `attempt_id`, a final fork-completion event, and Mobile `device_id` work.

## Capabilities

### New Capabilities

- `snapshot-save-observability`: First-party observation of snapshot save clicks, snapshot sign-in provenance, server-confirmed account attribution, and fork save outcomes.

### Modified Capabilities

None. The existing collection, HackerLinks, snapshot presentation, login modal, and callback recovery specifications retain their current observable contracts. This change adds a separate observability contract without changing those flows.

## Impact

- Shared event attribution types in `packages/contracts`.
- Web snapshot save control, sign-in modal, Google and Apple controls, OAuth state, and `/auth` callback.
- API login attribution validation and account event emission, plus bookmark save event emission for `/add_url` and its rate-limit boundary.
- Focused Web and API tests. No database schema, migration, dependency, visible UI, Mobile, Extension, or deployment change.
- All new event members are optional and additive. Older clients and API versions remain compatible; invalid or absent metadata does not change authentication or save outcomes.

## Review, Approval, and Scope Boundary

On 2026-11-12, the change requester reviewed and approved the plan in conversation: first add only observability and accumulate a baseline, then change automatic post-authentication saving in the separate `snapshot-save-auto-resume` change. This change implements only the measurement half.

This change does not define or implement automatic post-authentication saving; the separate `snapshot-save-auto-resume` change will define that behavior. This is a scope boundary, not a permanent prohibition. The change does not alter the existing user-visible save or login flow. It does not claim that real Google or Apple OAuth, deployment, or event-warehouse ingestion has been accepted. Those remain unverified and are recorded in `validation.md`.

The existing no-code `/auth` redirect to `/login` and the `EMAIL_AUTH_USE_EXISTING_LOGIN` recovery link retain their current behavior. They are not expanded to carry snapshot attribution in this change.
