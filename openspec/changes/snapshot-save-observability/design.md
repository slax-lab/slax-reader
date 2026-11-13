# Design

## Context

See `proposal.md` for motivation. The public snapshot page currently exposes the existing save control without a first-party element identifier. An anonymous activation opens the existing sign-in modal with only a return redirect. At this baseline, after authentication the reader returns to the snapshot page and the save control is not automatically activated; the current flow has no pending automatic action. Automatic continuation is defined by the separate `snapshot-save-auto-resume` change. The existing `bookmark_saved` and `bookmark_save_failed` facts identify the destination relation but not the source snapshot.

The repository already has an add-only first-party event pipeline and an established optional authentication-attribution pattern for public collections and HackerLinks. Collection attribution is Google-only at the API boundary. HackerLinks attribution applies only to newly created accounts. The implementation must extend the same transport without changing either established contract.

## Goals / Non-Goals

**Goals:**

- Observe both the anonymous and authenticated snapshot save activations with the same source snapshot identity.
- Distinguish snapshot-origin sign-in from ordinary sign-in and from collection or HackerLinks attribution.
- Attribute server-confirmed new-account and returning-account facts only when the login boundary validates the closed snapshot schema.
- Attribute fork admission and admission-failure facts to the source snapshot without renaming the destination `bookmark_id`.
- Keep every existing event name, visible flow, ordinary-save payload, and established attribution behavior unchanged.

**Non-Goals:**

- Defining or implementing automatic post-authentication saving, pending-action persistence, or second-click removal. That behavior belongs to the separate `snapshot-save-auto-resume` change; this change neither requires nor prohibits it.
- Final asynchronous fork-copy completion events, `save_kind`, or `attempt_id`.
- Mobile `device_id` changes.
- Snapshot attribution on the no-code `/auth` redirect to `/login` or on the `EMAIL_AUTH_USE_EXISTING_LOGIN` recovery link.
- Real OAuth, deployment, or event-warehouse acceptance.

## Decisions

### Extend the existing optional attribution union instead of overloading collection attribution

Add a distinct `SnapshotAuthAttribution` member to the shared Web attribution union. Its closed fields are `source_screen=detail`, `presentation=modal`, `trigger_element_id=snapshot_save_button`, and `source_bookmark_id`. A distinct guard keeps snapshot, collection, and HackerLinks branches recognizable.

Alternatives considered:
- Reusing `collection_id` for a snapshot would make the public-collection contract ambiguous and would risk collection queries counting snapshot saves.
- A generic bag of optional keys would weaken API validation and make stale or forged attribution harder to reject.
- A new auth-specific event name would duplicate the existing account facts and was explicitly out of scope.

### Observe the existing element click rather than add a save-specific event

Give the existing save control the existing `data-analytics-element` marker and a source-snapshot data attribute. The existing document-level click collector emits `element_clicked` with `screen_name=detail` and adds `source_bookmark_id` when that attribute is present. Because disabled controls do not dispatch the activation, pending and saved states produce no observation. This covers the anonymous first activation and the authenticated activation after the page reloads, without adding a new event or changing the save handler.

Alternatives considered:
- Emitting from the save composable would miss the anonymous click only if the composable returned early, and would couple observation to request admission rather than genuine control activation.
- A new event name would change the event vocabulary and reporting contract.

### Reuse the existing sign-in modal and provider transport

When the anonymous save path displays the existing modal, it passes the snapshot attribution through the same optional member used by collection attribution. The modal records the contextual `screen_viewed`. Google and Apple controls record an attributed `element_clicked` before leaving for the provider, both inside the snapshot modal and on the `/auth` recovery page for the same attempt. The snapshot attribution enters each provider's OAuth `state` and is parsed by the existing `/auth` callback.

Collection attribution remains Google-only where it is today: the modal does not pass collection attribution to its Apple control, and the API continues to reject collection attribution for Apple. HackerLinks remains a separate acquisition object. Snapshot attribution is accepted for both providers and for the existing email code flow inside the modal.

The modal and `showLoginModal` use a narrower `LoginModalAttribution` type of collection or snapshot provenance. The standalone Google, Apple, and email components retain the wider `WebAuthAttribution` type because the standalone login page still carries HackerLinks acquisition context. This prevents acquisition-only fields from being passed into the modal's contextual `screen_viewed` observation.

### Validate at the API boundary and attribute both account outcomes

`POST /v1/user/login` validates snapshot attribution with a closed schema. Unknown members are discarded; invalid or absent metadata is omitted without failing otherwise valid authentication. `source_bookmark_id` uses the same UUID shape as `sr_user_bookmark.uuid` at both the `/auth` and API boundaries. A valid snapshot object is attached to the existing `user_created` fact for a new account and to `user_logged_in` for a returning account, for Google, Apple, and email. This differs from HackerLinks, which remains new-account-only, and from collection attribution, whose provider and outcome rules remain unchanged.

The attribution remains provenance only. It cannot supply `user_id`, provider method, token, permission, or redirect authority; those continue to come from the authenticated request and provider exchange.

### Detect fork saves at the existing `/add_url` boundary

The API already recognizes trusted Reader snapshot URLs for fork routing. Reuse that same helper on `/v1/bookmark/add_url`: when the request target is a trusted `/b/<uuid>` URL, add `source_bookmark_id` to the existing `bookmark_saved` or `bookmark_save_failed` properties. The destination relation continues to use `bookmark_id`. Ordinary URL saves, the content `/add` endpoint, and lookalike URLs from other origins receive no source property. A rate-limited `add_url` attempt receives the same source property; a rate-limited content save does not.

The rate-limit boundary reads at most a 100 KiB clone of the request body. When `Content-Length` is absent, it uses a bounded stream read instead of skipping the body entirely, so a legitimate small chunked body retains attribution while an oversized or streaming body is abandoned without being parsed. It also applies the save handler's existing HTTPS normalization before source recognition, so a scheme-less snapshot target is treated consistently.

Alternatives considered:
- Inferring the source from the destination relation would require an additional lookup and would not cover rejected admissions that never created a relation.
- Adding a request field would change the public save contract; the target URL already carries the trusted source identity.
- A `save_kind` discriminator was explicitly excluded.

### Keep recovery-path scope unchanged

A recoverable callback failure that offers a fresh provider authorization preserves the snapshot attribution alongside the existing return and referral context. The recovery page passes that attribution to its Google or Apple control, which records the attributed provider click before a new authorization attempt. The no-code path that redirects to `/login`, and the provider-conflict link that returns to `/login`, retain their current behavior and do not carry snapshot attribution. Extending those paths would change the login-page query contract and recovery flow, which this measurement-only change does not authorize.

### Trace the contract to the Q7 decision

The emitted fields and the `element_clicked` scope implement Q7 of the separate `slax-reader-event-tracking` analytics repository, whose decision record is `decisions/Q7-快照保存任务完成.md` in that repository. The reference is a repository-relative path rather than a URL because that decision is not on a merged main branch yet.

That repository owns the metric definitions and requires its own branch and pull request; that pull request must land before this measurement change merges, so the definition of completion exists before the events that feed it are deployed. This design repeats only what is emitted; the handbook and Q7 plan in that repository remain the authority for the metric.

### Verify additive compatibility with focused evidence

Use focused Web component and composable tests plus API domain tests. The Web checks cover anonymous and authenticated activation, the same source on both, ordinary login, Google and Apple transport, callback parsing, recovery-page attribution propagation, attributed provider-click emission, and collection non-regression. The API checks cover new and returning accounts, invalid and forged metadata, fork success, admission failure, rate limiting, ordinary saves, and lookalike origins. Record the exact commands and results, plus every unverified runtime boundary, in `validation.md`.

## Risks / Trade-offs

- **Sign-in recovery can produce a duplicate provider click observation.** The `/auth` recovery screen is a signup screen, so the existing global click collector also sees a provider button while the attributed component handler emits its own observation. This overlap already exists for collection attribution and is not changed here. Analysis should treat attributed and unattributed recovery observations distinctly rather than assuming one click always equals one event.
- **Source detection uses the request URL before any short-link resolution.** The Web snapshot control sends a direct trusted `/b/<uuid>` URL, so this change is accurate for its target flow. A future client that resolves a short link into a snapshot URL at the server may need a separate decision.
- **Optional metadata can be dropped by design.** Older API or client versions ignore or omit snapshot attribution while preserving authentication and saving. Missing attribution is a data-quality gap, not an inferred value.
- **Attribution can be confused with identity.** All fields are closed and non-authoritative; server identity, method, and save outcomes remain authoritative.

## Migration Plan

No database migration or schema change is required. Deploying the Web client and API independently is safe because all new members are optional: an older API omits unrecognized attribution without failing login, and an older client sends no snapshot attribution. Rollback is a normal code revert; no stored data or event records need rewriting. Existing events and dashboards remain compatible because no event name or required property changes.

## Open Questions

None within this change. Automatic post-authentication saving is defined by the separate `snapshot-save-auto-resume` change; a final fork-completion event and recovery-path attribution remain separate product decisions outside the approved scope.
