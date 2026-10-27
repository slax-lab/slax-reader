> Implementation update: `openspec/changes/support-newsletter-feed/design.md` is authoritative for construction. The implementation uses durable raw-message receipts and cron recovery, explicit deployment admission flags, and the dev defaults accepted on 2026-10-22. This feasibility review remains background evidence.

> Superseded routing decision (2026-10-27): the user approved `<account>@slax.dev` for dev and `<account>@slax.app` for production, using root-domain Catch-all routing. The subdomain and exact-address pilot discussions below are historical research, not current operator instructions. `daguang@slax.app` remains a business forwarding address. Follow the current OpenSpec design and [dev rollout guide](../../api/NEWSLETTER-DEV-PILOT.md); production stays disabled during dev acceptance.

# Newsletter and unified Feed feasibility assessment

Date: 2026-10-22 (Asia/Shanghai). Audience: the feature owner, backend engineer, Web engineer, and deployment operator.

Newsletter support is feasible with the current API and Web architecture. The main work is reliable inbound delivery, permanent address ownership, source-type isolation, and compatibility with existing RSS clients. The implementation can reuse RSS entry storage, sanitized R2 content, image proxying, PowerSync, and the Web reader. The requested receiving domain remains an operational feasibility gate: ordinary Cloudflare Email Routing subdomains do not support catch-all routing.

This assessment incorporates the task screenshot, repository inspection, the earlier construction plan, and the user's confirmed address rules. It supersedes conflicting recommendations in the [earlier construction plan](2026-10-21-support-newsletter-feed.md). The existing [OpenSpec proposal](../../../openspec/changes/support-newsletter-feed/proposal.md), design, tasks, and delta specs still describe earlier decisions and must be reconciled and reviewed before implementation. This assessment does not authorize deployment or establish that the feature has been implemented.

## 1. Requirements and decision status

### Task requirements

- Receive newsletters at a personal address under `newsletterreader.slax.com`.
- Present a fixed Web navigation entry named **Feed**, replacing RSS-specific entry wording.
- Display RSS and Newsletter entries in one Feed.

The recommended interpretation of “fixed” is that the Feed entry remains visible even when neither acquisition feature is enabled. That state shows onboarding. Source access and ingestion remain subject to feature authorization; navigation visibility does not grant access. This interpretation should be preserved in the revised proposal unless the product owner explicitly changes it.

### Address rules confirmed by the user

| Topic              | Agreed behavior                                                                                                                    |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| Initial local part | Derive it from the user's `account`, not their display `name` or login `email`.                                                    |
| Missing account    | Ask the user to set an account name before provisioning an address.                                                                |
| Validation         | Validate email-safe characters and uniqueness, normalize the local part to lowercase, and repair relevant gaps in the legacy path. |
| Persistence        | Save the issued address as a binding and resolve incoming mail through that binding.                                               |
| Account changes    | An issued address remains unchanged when `account` or the display name changes.                                                    |
| Ownership          | An address previously issued to one user must never be reassigned to another user.                                                 |
| Feed source label  | Use the newsletter sender's display name/address, independently of the recipient's account name.                                   |

Example: a user with `account = Alice` receives `alice@newsletterreader.slax.com`. After the account changes to `alice-reading`, the receiving address remains `alice@newsletterreader.slax.com`. A different user who later holds `account = Alice` cannot claim that reserved address.

### Proposed first-release scope requiring product review

| Choice                    | Recommendation                                                                                       | Consequence                                                                                                                               |
| ------------------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Feature switches          | Keep RSS and Newsletter independently enabled through Labs.                                          | A fixed Feed entry can guide a user to enable either feature.                                                                             |
| Disable Newsletter        | Reject new delivery, hide Newsletter rows, preserve the address reservation and retained entries.    | Messages rejected during disablement are not recovered on re-enable.                                                                      |
| Save to Inbox             | Defer Newsletter-to-Inbox saving in the first release.                                               | Received content must have its own explicit retention policy.                                                                             |
| Retention                 | Keep Newsletter out of the existing automatic 30-day RSS expiry until a separate policy is approved. | Production needs an approved storage/quota policy; indefinite unlimited storage is not assumed.                                           |
| Remote images             | Reuse the signed image proxy on view, if product accepts open-tracking exposure.                     | The origin can observe a cache-miss image request associated with an open; the proxy does not provide reader-IP disclosure to the origin. |
| Initial protection limits | Evaluate 5 MiB raw message size, 200 sources per user, and 200 new messages per user per UTC day.    | These are proposed application limits, not agreed requirements or Cloudflare defaults. Duplicates must not consume message quota.         |
| Source management         | Provide a way to remove or block a Newsletter source if source-count quotas ship.                    | A hard lifetime source cap with no recovery action can permanently prevent receipt.                                                       |

Attachments, `cid:` inline-image restoration, outbound email, automatic replies, automatic subscription confirmation, and automated unsubscribe handling are proposed exclusions. Subscription-confirmation messages should still be readable, with safe links the user can follow manually.

## 2. Existing implementation and useful reuse

| Area               | Current implementation                                                                                                                                                                                                                                    | Implication                                                                                                                           |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Old mail switch    | [`UserService.updatePlatformSetting`](../../../apps/api/src/domain/user.ts) handles `mail_collect`; enabling binds `account` to `<account>@reader.slax.com`.                                                                                              | Reuse the association concept, but not the rename and deletion lifecycle unchanged.                                                   |
| Old mail processor | [`EmailService.processEmail`](../../../apps/api/src/domain/email.ts) extracts the recipient local part and the first URL in plain text; the bookmark-save call is commented out. No current Worker entry invokes it.                                      | It is a stub, not a functioning Newsletter ingestion pipeline. Save the email body rather than fetching its first link.               |
| Binding repository | [`UserRepo`](../../../apps/api/src/infra/repository/dbUser.ts) serializes platform binding and checks another user's exact platform ID.                                                                                                                   | The existing checks do not define case-normalized, permanent Newsletter address ownership.                                            |
| Account field      | [`sr_user.account`](../../../apps/api/prisma/pgsql.prisma) defaults to an empty string and has a normal index. The setting path calls a lookup that throws when no account matches.                                                                       | Confirm and test the apparent inverted account availability check. Do not assume existing accounts are globally unique or email-safe. |
| Worker ingress     | [`edge/index.ts`](../../../apps/api/src/entry/edge/index.ts) exposes `fetch`, `queue`, and `scheduled`; core helpers initialize services for non-HTTP events.                                                                                             | Add an `email()` event handler and a properly initialized domain service.                                                             |
| Feed content       | [`RssContent`](../../../apps/api/src/domain/rss/content.ts), [`sanitizeFeedHtml`](../../../apps/api/src/domain/rss/feed.ts), and [`RssRepo`](../../../apps/api/src/infra/repository/dbRss.ts) provide R2 content, sanitation, entry storage, and cleanup. | Reuse this machinery with explicit Newsletter lifecycle rules.                                                                        |
| Web                | [`RssPanel`](../../../apps/web/app/components/RssPanel.vue), [`useRss`](../../../apps/web/app/composables/useRss.ts), and the local RSS composables provide reader UI, caching, and REST fallback.                                                        | Extend the presentation and data layer rather than building a second reader.                                                          |
| Mobile             | [`RssRepository`](../../../apps/mobile/src/data/repositories/rss.ts) subscribes to `rss_v1`, while [`SlaxApi`](../../../apps/mobile/src/data/api.ts) and [`RssController`](../../../apps/mobile/src/rss/controller.ts) also read RSS REST endpoints.      | Preserving only the sync stream is insufficient; legacy REST reads must remain RSS-only too.                                          |

Existing source code does not establish whether old email bindings or external routing rules are in use in production. Audit that state before removing the old writer or retiring `reader.slax.com` routes.

## 3. Recommended architecture

```text
Inbound sender
      |
      v
Validated mail-routing configuration
      |
      v
Edge email() handler
      |
      v
Address registry + recipient authorization
      |
      v
MIME parse + safe content normalization
      |
      +--> R2 sanitized body
      |
      +--> PostgreSQL source, subscription, entry
                    |
                    +--> newsletter_v1 --> Web local Feed list
                    |
                    +--> Feed read API --> Web fallback and detail

Existing RSS acquisition --> same entry storage --> rss_v1
Legacy RSS REST API ----------------------------------> existing clients
```

Use one synthetic Newsletter source per user and normalized sender, with `sr_rss_feed.kind = 'newsletter'`. Existing and future RSS sources default to `kind = 'rss'`. Include the user UUID in synthetic source identity so mail received by different users never shares a private source or entry. Do not put raw sender addresses or numeric user IDs into client-visible synthetic URLs; a sender hash can form the remaining source key.

The `email()` function is a Worker event handler, separate from `fetch()`. Native Email Routing calls it; users do not submit incoming mail through a public HTTP endpoint. The incoming MIME parser can be `postal-mime`, which [Cloudflare recommends](https://developers.cloudflare.com/email-service/api/route-emails/email-handler/). Pin and evaluate the chosen version, its package scripts, license, resource limits, and behavior in the repository's Worker runtime before adopting it.

## 4. Permanent receiving-address ownership

### Authoritative address registry

The old `sr_platform_bind` table is not sufficient by itself for the agreed non-reassignment rule: account deletion currently removes platform bindings. Once deleted, an old prefix could otherwise be issued to somebody else.

Recommend a dedicated address registry, provisionally `sr_newsletter_address`, with:

- A canonical receiving domain and lowercase local part, protected by a database unique constraint over the pair.
- An active owner reference while deliverable, and an explicit active/retired state.
- A database constraint allowing at most one active Newsletter address per user in the receiving namespace.
- Creation and retirement timestamps.
- A retained reservation after retirement or account deletion, with the active delivery mapping removed. Do not cascade-delete the reservation or release the address for reuse. Decide the minimal retained marker and its data-retention treatment during schema review.

The registry is the authority. If compatibility requires a platform-binding mirror, update it through the same provisioning transaction; do not maintain two independent ownership checks. Avoid changing the old domain's bindings implicitly.

### Provisioning and lookup

1. Authenticate the user and require Newsletter enablement.
2. Return an existing active address before inspecting the current account name. This preserves the address after rename, including a rename to a value unsuitable for email.
3. For first provisioning, require an account name and lowercase its ASCII local part.
4. Recommended initial validation: 1-64 ASCII octets; start with a letter or digit; allow letters, digits, underscore, hyphen, and internal dots; reject whitespace, leading/trailing or consecutive dots, and reserved operational names. Review the exact validator before implementation. Do not silently rewrite an invalid name into a different prefix.
5. Reserve and bind the address atomically. A conflict, including a retired reservation, returns an actionable address-unavailable result. Do not silently append a random suffix or select one owner from colliding historical accounts.
6. Publish the address to the client only after the reservation commits. Concurrent provisioning retries return the same address.

Lock user mutations consistently with the existing user-row locking used by Labs. Recheck active-user and Newsletter authorization within the final ingestion transaction. Address uniqueness must be enforced in the database, not only by advisory locks.

Fixing the username-setting path needs an explicit test for available and taken names. Newsletter uniqueness can be guaranteed by the new registry without imposing a potentially breaking global uniqueness migration on all historical accounts.

## 5. Ingestion, idempotency, and retention

### Delivery sequence

1. Apply the approved raw-size limit before buffering MIME. Consume `message.raw` only once.
2. Resolve the SMTP envelope recipient `message.to`, validate its complete domain, and consult the authoritative registry. Do not route using the visible `To` header or a fresh lookup of `sr_user.account`.
3. Reject unknown, retired, deleted-user, or disabled-recipient delivery with a consistent recipient response. This avoids distinguishing those failure cases; it does not prevent discovering a functioning address through successful delivery.
4. Parse MIME into decoded subject, sender, text, and HTML. Group sources by a normalized header sender with a documented fallback; do not use a per-message ESP bounce address as the source identity. Sender names are untrusted display data, not verified identity badges.
5. Compute a delivery key scoped to the recipient and source. Use `Message-ID` when present; otherwise include stable decoded body content as well as sender, subject, and source date. Two different bodies with equal sender/subject/date must remain distinct.
6. Check duplicates before applying new-message/source quotas or doing unnecessary R2 work. For concurrent retries, serialize admission and use database uniqueness as the final guard. A duplicate is a successful no-op; do not copy RSS's mutable-entry upsert semantics into mail delivery or overwrite a received body with a later conflicting payload.
7. Sanitize the body and write the R2 object, then commit the source, subscription, and entry reference with final recipient/feature checks and transactional quota enforcement. R2 and PostgreSQL are not one transaction: a failed commit can leave an orphan object, but must never publish a row pointing to a missing object.
8. Complete the event only after the required persistence succeeds. Reuse content GC for orphaned RSS-prefix objects, with an adequate grace period for in-flight delivery.

Use a valid source date, bounded against future dates, with server receipt time as the fallback. Define one stable sort timestamp and an ID tie-breaker for mixed-source pagination. Compute summary/truncation metadata from the same normalized content used for storage.

### Failure handling

`message.setReject()` produces a permanent SMTP error, as documented in the [Workers email API](https://developers.cloudflare.com/email-service/api/route-emails/email-handler/). Do not use a permanent unknown-address rejection for transient database or storage outages.

Start by testing direct, awaited processing in a staging Worker. Determine actual SMTP outcomes for thrown exceptions, timeouts, and transient storage failures; do not assume the platform retries application failures. If a recoverable-delivery guarantee cannot be established, add a durable ingress design: store a bounded raw object under a separate prefix, commit a retryable receipt/outbox, and use a queue plus reconciliation to process it. A successful accept must imply a durable processing obligation. A raw R2 write plus an unawaited queue send is insufficient.

Record delivery outcome codes and opaque correlation IDs. Do not log bodies, raw MIME, recipient addresses, sender addresses, tracking URLs, or subscription tokens. No auto-replies or external notifications are required by this feature.

### Body and image behavior

Reuse the existing allowlist renderer and signed image-proxy path. Preserve safe text and tables, but expect authored email layout to change because styles and many attributes are removed. Escape plain text before adding HTML wrappers. Remove unsupported relative links/images and `cid:` references before resolving them against the RSS placeholder base. The current sanitizer's budget counter starts at `220 * 1024`, using JavaScript string lengths and per-element charges, plus node/depth limits; it is not an exact UTF-8 byte limit. Propagate `content_truncated` correctly.

If proxy-on-view is selected, document the tracking tradeoff and test it. Do not claim that sanitation removes every tracking pixel: the existing sanitizer does not provide that guarantee. Remote-image privacy remains a product decision.

### Separate lifecycle policies

- Exclude Newsletter sources from RSS polling, refresh leases, history fetching, fetch-error/backoff state, and the 20-RSS-subscription limit. A far-future fetch timestamp is only a secondary safeguard.
- Keep the RSS 30-day expiry explicitly RSS-only. Define Newsletter retention and quota behavior independently before production delivery is enabled.
- Continue generic cleanup of orphaned Newsletter sources, deleted-user content, and unreferenced R2 objects. “Never poll Newsletter” must not become “never clean up Newsletter.”
- A source block/removal must remain meaningful when the next message arrives; do not recreate a blocked source automatically. Exact source-management semantics belong in the reviewed first-release scope.

## 6. API and client compatibility

Recommend additive Feed read endpoints instead of broadening existing RSS reads. These paths and shapes are proposed contracts for OpenSpec review, not existing routes:

| Endpoint                           | Intended behavior                                                                                                                     |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /v1/user/newsletter_address`  | Read the authenticated user's existing address without provisioning side effects; distinguish not-yet-provisioned state.              |
| `POST /v1/user/newsletter_address` | Idempotently provision or return the user's fixed address; report missing/invalid account, reservation conflict, or disabled feature. |
| `GET /v1/feed/subscriptions`       | Read only the current user's authorized source kinds; include an explicit `kind` for every source.                                    |
| `GET /v1/feed/entries`             | Read the mixed timeline with source filtering, stable cursors, and RSS-only history acquisition when explicitly requested.            |
| `GET /v1/feed/entries/:id`         | Read sanitized entry content after ownership and source-kind feature checks.                                                          |

Reuse the existing API envelope, authentication, private/no-store response headers, and paging conventions. Bind cursors to user, source selection, and the effective source-kind set. Revalidate `before` anchors and entry detail against that same access scope. When no authorized source kind is enabled, return the defined feature-disabled result and let the visible Feed show onboarding.

Keep `/v1/rss/*` reads and mutations RSS-only, including direct detail requests by ID. Existing RSS add/rename/delete/refresh/save behavior remains gated by RSS. The Web can reuse those write endpoints while reading mixed content through the new Feed facade. Reuse repository and content services behind both facades rather than duplicating the storage pipeline.

Add explicit Feed DTOs with a required `kind`, reusing appropriate RSS fields while keeping existing RSS response contracts intact. Consider operation capability flags in the reviewed Feed contract if they clarify source actions; `article_url = null` alone must not define the source kind. RSS history availability applies only to RSS sources, and cached Newsletter pagination must terminate normally.

## 7. PowerSync and Web integration

Restrict `rss_v1` to RSS sources and their subscriptions/entries while preserving its current columns. Add `newsletter_v1`, authorized by the Newsletter feature and current-user ownership. Both streams can target the existing three local Feed tables with disjoint source/entry identities. Add `kind` to the Web schema and require a documented RSS fallback for old stream rows where the column is absent/null.

Only the owning user's source subscriptions and entries may synchronize. Do not sync content bodies, R2 content keys, entry dedupe keys, raw lease tokens, fetch validators, or global address reservations. Preserve the existing RSS `refreshing_until` projection that its clients use; Newsletter rows need no fetch-lease metadata. Validate rule syntax and actual server behavior; string-based tests alone do not prove that a production PowerSync service accepts the new rules.

In Web, subscribe to each enabled source stream independently, preserve account ownership checks, and cancel the affected stream when its feature is disabled. Remove only that kind's UI/cache overlays. A pending or failed Labs request can preserve already admitted account-owned cached data; a confirmed disabled state revokes that kind. One failed stream must not unnecessarily hide healthy cached data from the other kind. Use the Feed REST facade for fallback and body reads.

The Web surface should provide:

- A fixed Feed entry and a shared RSS/Newsletter timeline, retaining existing selection, scrolling, and list-mode behavior.
- Address provisioning, display, and copying, including in an empty Feed; explain that the address stays fixed after account rename.
- Actionable states for missing account, invalid account, unavailable prefix, loading, offline, and provisioning failure.
- Sender labels and local fallback avatars for Newsletter sources; no attempt to fetch a favicon from a synthetic `newsletter:` URL.
- RSS-specific add/refresh/save controls only where applicable. Define Newsletter source removal/blocking separately from RSS unsubscribe.
- Light, dark, and e-ink coverage, keyboard states, localized copy, reduced motion, the 768px transition, and narrow-screen behavior required by [DESIGN.md](../../../DESIGN.md).

Newsletter support on Mobile is outside the proposed first release. Preserve both its sync and REST inputs; do not conclude that it is unaffected solely because `newsletter_v1` is separate. A later Mobile implementation would require its own UI/schema scope and version decision.

## 8. Cloudflare feasibility and operator work

### The requested domain is a prerequisite, not a completed configuration

Current [Cloudflare subdomain documentation](https://developers.cloudflare.com/email-service/configuration/subdomains/) restricts catch-all rules to the zone apex. If `newsletterreader.slax.com` is an ordinary Email Routing subdomain of `slax.com`, the earlier plan's subdomain catch-all step is unsupported. [Routing configuration documentation](https://developers.cloudflare.com/email-service/configuration/email-routing-addresses/) states the same restriction for Wrangler-managed wildcard addresses.

| Candidate                                                                                  | Suitability                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Native catch-all on the requested name through an independently supported zone arrangement | Preferred if the operator verifies account/plan eligibility, DNS ownership, and routing behavior. Do not assume subdomain delegation alone makes this available.                                                                                |
| Literal address rules on the ordinary subdomain                                            | Suitable for a bounded pilot. Default [routing limits](https://developers.cloudflare.com/email-service/platform/limits/) allow 200 rules per domain, so this is not the general user-allocation architecture without an approved capacity plan. |
| Another inbound provider that accepts arbitrary local parts on the requested domain        | Can preserve the address format, but adds provider contracts, credentials, cost, authenticated delivery, replay protection, and failure-handling work. Evaluate separately if native routing is unavailable.                                    |
| A dedicated receiving apex domain                                                          | A product-approved fallback if the requested domain cannot support the chosen ingress. It changes the task's address format and is not implicitly approved.                                                                                     |

Different address rules on one domain can target different Workers; the limitation is not “one domain can only use one Worker.” Dev, beta, and production need an explicit recipient/domain-to-environment mapping. An arbitrary additional subdomain does not by itself solve catch-all support.

### First stage confirmed by the user: dev on slax.dev

Start with the dev installation. The user has Cloudflare console access for this environment. Public DNS checks on 2026-10-22 returned Cloudflare nameservers, Cloudflare routing MX records, and the Cloudflare SPF include for `slax.dev`; `newsletterreader.slax.dev` returned NXDOMAIN. These checks establish published DNS, not the current dashboard rule destinations, Worker handlers, or database isolation.

The user reported an existing **Catch-all / Drop / Active** rule in the `slax.dev` dashboard. This rule does not invoke a Worker; unmatched mail is silently discarded. Preserve it during the literal-address pilot. Cloudflare checks specific recipient rules before applying catch-all when none match, as described in the [inbound email lifecycle](https://developers.cloudflare.com/email-service/concepts/email-lifecycle/). The dev target Worker identity has been confirmed below; its email-handler readiness still needs implementation and verification.

The user confirmed in the Cloudflare dashboard that Worker **`reader-backend`** has **`reader-api.slax.dev`** in Domains & Routes. This is the confirmed dev ingress target for the pilot. Use that deployment identity rather than the repository's legacy `reader-backend-dev` fallback when preparing routing instructions; preserve the operator-maintained configuration that selects the deployed Worker. Domain association does not establish its database/R2 bindings or whether an `email()` handler is deployed.

Recommend `<test-account>@slax.dev` for the first bounded pilot, with `NEWSLETTER_DOMAIN=slax.dev` in dev. This keeps the agreed `account` local-part behavior while testing an apex receiving domain. It is a dev-only namespace; it does not change the required production domain or prove that production subdomain catch-all will work.

Use this sequence:

1. Use the confirmed dev route inventory: **Catch-all / Drop / Active**, and target **`reader-backend`**, associated with **`reader-api.slax.dev`**. Keep the catch-all unchanged. Before deployment, ensure the effective dev configuration retains this deployed identity rather than creating or targeting a Worker based on the legacy naming fallback.
2. Verify that the dev Edge, Web, PostgreSQL, R2, and PowerSync form the intended test installation. Repository documentation describes dev as separate; actual bindings and the dev sync publication owner still need operator verification.
3. Revise and review the OpenSpec change for a bounded dev pilot, then implement the handler and application pipeline, exercise it locally, and deploy to the authorized dev environment. Existing `fetch()` support alone does not make the Worker ready for mail.
4. After the handler and persistence path are ready, add one or two literal test-address rules in the dashboard, using **Send to a Worker** and the verified dev Edge. Preserve other rules and the existing catch-all destination. The initial pilot needs no new receiving subdomain or wildcard rule.
5. Deliver test mail to the explicitly routed test accounts and verify parsing, dedupe, ownership, the fixed issued address, and appearance in dev Web Feed. Check feature disablement and storage failures against those routes. To exercise the application's unknown-recipient rejection, temporarily route a dedicated unbound test address to the Worker; an arbitrary address that only hits the existing Drop catch-all tests Cloudflare discard, not application rejection. Keep those outcomes distinct in the evidence record.
6. Test arbitrary-address routing only in a later deliberate step after reviewing existing catch-all use. A successful literal-rule pilot proves the application path for those addresses, not wildcard delivery or the production domain arrangement.

The user/operator supplies the existing rule inventory, verifies the dev resource targets, and performs or authorizes dashboard changes. Backend/Web implementation, local verification, deployment preparation, and evidence capture can be carried out by the engineers/agent. Human UI acceptance remains part of the dev pilot. Production routing and the shared beta/production database remain later release gates.

### Work to perform after selecting a supported route

1. Record the receiving namespace, zone arrangement, DNS records, route ownership, target Worker, and environment mapping.
2. Provision required receive-side DNS/routing without changing unrelated mail service records. Deploy the handler before enabling real delivery. `NEWSLETTER_DOMAIN` is ordinary configuration, not a secret. Provider/API automation credentials, if needed by an alternative, have their own approval and secret-management requirements.
3. Verify the deployed Edge has the required PostgreSQL/Hyperdrive, R2, and optional queue bindings. HTTP service bindings do not automatically forward email events.
4. Start the dev pilot with dashboard-managed rules. If configuration-managed routing is adopted later, first change the generator to retain `addresses` only for Edge and omit it from Core, AI, and Browser. A local sample confirmed that the current generator copies the field into all four projections; a normal deployment could otherwise attempt to transfer the same rules between Workers and fail. The repository's Wrangler range is newer than the documented 4.113.0 minimum for `addresses`; the field is top-level and not environment-scoped according to the current routing docs.
5. Establish how production PowerSync rules are deployed. The inspected repository contains local rules, not a complete production publication runbook.
6. Test real SMTP delivery and failure behavior, then enable the route for the agreed rollout audience.

Cloudflare's [local routing test endpoint](https://developers.cloudflare.com/email-service/observability/local-development/routing/) is `/cdn-cgi/local/email`, with envelope `from`/`to` parameters and raw RFC 5322 content. It can exercise the handler once integrated into the repository's local Worker startup. It does not verify public DNS, real SMTP, or remote failure semantics. Cloudflare currently documents a [25 MiB inbound platform limit](https://developers.cloudflare.com/email-service/platform/limits/); a proposed 5 MiB application limit is deliberately smaller and includes the raw MIME/attachments.

## 9. Delivery sequence and rollback

### Before implementation

1. Review this assessment and settle first-release feature, retention, image, quota, and source-management choices.
2. For the first stage, validate the `slax.dev` pilot route and dev PowerSync publication path with the operator. Resolve the required production receiving-domain arrangement and production PowerSync publication path before extending the rollout beyond dev.
3. Reconcile `support-newsletter-feed` proposal, design, tasks, and scenarios: fixed address after rename, permanent reservations, fixed Feed entry, separate cleanup policies, additive Feed APIs, and actual routing strategy.
4. Confirm the task branch/change naming and current `origin/dev` base before implementation; reconcile the earlier branch's archive dependency with actual merge state. Obtain human review of the revised proposal.

### Implementation and rollout

1. Inventory legacy account/binding collisions on an authorized non-production copy, reporting counts only. Decide explicit handling for each migration class; never choose an arbitrary owner.
2. Add the address registry and `kind` through expansion-only migrations. New tables can enforce their own uniqueness immediately; do not condition all future mailbox correctness on a new index over dirty legacy bindings.
3. Add source-type isolation to reads, writes, polling, retention, and legacy RSS endpoints before any Newsletter rows are accepted. For beta/main, this requires a compatibility release reaching every serving Worker and sync-rule consumer of their shared production PostgreSQL before either environment admits Newsletter rows. Keep admission disabled until that barrier is verified. Earlier dev/staging ingestion must use isolated test PostgreSQL and matching R2 storage; different mail domains alone do not isolate shared rows.
4. Implement provisioning, ingestion, additive Feed APIs/contracts, sync rules, Web behavior, and focused tests.
5. Prepare a local/staging environment, including authorized test routing where needed. Perform agent-driven real delivery and failure checks, then human UI acceptance before opening the implementation PR. Record adjustments and rerun affected checks.
6. After review and merge, use the approved release process for compatible storage/API changes, publish validated PowerSync rules before the released Web subscribes to the new stream, and deploy Web.
7. Enable production receiving routes only after all application dependencies and verification are ready, then verify the agreed rollout audience and delivery outcomes.

Remote migrations, deployment, routing changes, and sending real test emails require their applicable authorization when executed. Writing this assessment does not perform them.

### Safe rollback

Pause new delivery using a tested operator procedure, then roll back presentation and ingestion as needed while retaining compatibility for stored Newsletter rows. Preserve address reservations, the `kind` column, RSS-only legacy reads, polling/expiry isolation, and sync filtering. Never make a retired prefix available to a different user. If stopping a route discards or rejects mail, the chosen operational behavior must be recorded rather than described as recoverable buffering.

An old binary can remain schema-compatible while being behavior-incompatible with Newsletter rows. Do not revert to pre-isolation RSS logic or older broad sync rules merely because the added columns have defaults. Keep the expanded schema during rollback and retain a version that safely recognizes the new kind.

## 10. Verification and acceptance

| Area                    | Required evidence before release                                                                                                                                                                                                 |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Addresses               | First creation from `account`, lowercase handling, invalid/reserved prefix, concurrent provisioning, conflicts, rename stability, disable/re-enable stability, and deletion followed by another user attempting the same prefix. |
| Delivery                | Envelope-vs-header recipient, unknown domain/address, inactive user, disabled feature, HTML/text/multipart mail, malformed/oversized MIME, and subscription-confirmation content.                                                |
| Idempotency and races   | Repeat Message-ID; fallback with same sender/subject/date but different bodies; concurrent retries; duplicate at the quota boundary; feature disable/deletion during parsing or R2 work.                                         |
| Persistence and failure | R2 failure, database failure after R2 write, timeout, Worker exception, duplicate recovery, orphan cleanup, and durable-accept/retry guarantees for the selected ingress mode.                                                   |
| RSS regression          | Polling, refresh, history, subscription quota, retention, existing saved bookmarks, RSS-only REST behavior, and legacy Mobile REST fallback.                                                                                     |
| Sync and isolation      | RSS-only, Newsletter-only, both-enabled, neither-enabled, another user's data, live disable/re-enable, logout/account switch, null legacy `kind`, and partial stream failure.                                                    |
| Web                     | Fixed navigation, empty-state address/copy, mixed timeline, source controls, errors/offline/reload, three themes, responsive widths, accessibility, and human hands-on acceptance.                                               |
| Operations              | Real SMTP receipt, route-to-environment mapping, rejected-address behavior, storage outage outcomes, production sync-rule deployment, and rollback with existing Newsletter data.                                                |

Use the repository's root command abstractions during implementation:

```sh
pnpm api -- gen:diff
pnpm api -- migration:local
pnpm api -- gen:all
pnpm api -- typecheck
pnpm api -- lint
pnpm api -- test
pnpm api -- build
pnpm --filter @slax-reader/contracts typecheck
pnpm web -- typecheck
pnpm web -- test
pnpm web -- build
pnpm exec openspec validate --all --strict
```

The first two commands generate/apply local migrations after verifying the database target. Code generation and builds write generated artifacts; this is a future implementation checklist, not commands executed by this feasibility assessment. Real local and staging exercises remain necessary in addition to automated checks.

Record implementation evidence in `openspec/changes/support-newsletter-feed/validation.md`. Record agent checks, real running-environment exercises, explicit gaps, and human UI acceptance. Follow `REVIEW.md` for pre-push review and the repository PR template. Reassess indirect CLI/Extension/Mobile package effects before handoff; if any shipped behavior or output is affected, obtain the required application version decision. No version bump is needed solely to write this assessment.

## 11. Effort and release prerequisites

For an engineer familiar with this repository, budget a 0.5-1 day ingress/operations investigation, followed by approximately 5-8 engineering days for a release candidate once the supported route and product decisions are settled. This is a planning estimate, not a delivery commitment.

| Work area                                                              | Approximate engineering effort |
| ---------------------------------------------------------------------- | ------------------------------ |
| Address registry, validation, and legacy-state handling                | 1-1.5 days                     |
| Ingestion, source isolation, persistence, and additive APIs            | 1.5-2 days                     |
| PowerSync, Web data layer, and Feed presentation                       | 1.5-2.5 days                   |
| Regression, live delivery, failure testing, and acceptance preparation | 1-2 days                       |

An external inbound provider, durable raw-mail processing/outbox, complex legacy repair, or a broader source-management UI can add approximately 2-4 days or require a revised estimate after discovery. Waiting for permissions, DNS, infrastructure availability, product decisions, and human acceptance is additional elapsed time.

The feature owner and backend/operator should resolve these prerequisites first:

1. A supported arbitrary-recipient path for the requested receiving domain, including environment mapping.
2. An approved Newsletter retention/storage/quota policy and the behavior at each limit.
3. First-release decisions for separate Labs, images, Inbox saving, and source removal/blocking.
4. Legacy address/account migration handling, the account-setting bug scope, and production PowerSync deployment ownership.
5. Measured acceptance/failure semantics for the chosen SMTP-to-storage path.

The code architecture is viable. Production readiness remains conditional on those decisions and running-environment evidence; a successful OpenSpec syntax check alone does not settle them.

## 12. Changes from the earlier construction plan

| Earlier assumption                                                       | Revised assessment                                                                                   |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| Email address follows account rename and old names can be claimed later. | Issue once from `account`, then preserve the address and reserve it permanently against other users. |
| Existing platform binding alone owns the address.                        | Add a durable reservation lifecycle that survives removal of platform bindings and user cleanup.     |
| Hide Feed when both Labs are off.                                        | Keep Feed visible and provide onboarding, following the task wording.                                |
| Ordinary subdomain catch-all is a routine dashboard step.                | Verify a supported route first; ordinary subdomain catch-all is not documented as supported.         |
| Broadening RSS reads is safe if Mobile only subscribes to `rss_v1`.      | Mobile also reads REST. Preserve RSS reads and introduce an additive Feed read facade.               |
| RSS duplicate upsert can be reused unchanged for email.                  | Treat repeat delivery as a no-op and include body content in the fallback fingerprint.               |
| Reuse 30-day cleanup or skip Newsletter cleanup entirely.                | Separate Newsletter expiry from generic orphan/deletion/GC behavior and approve a retention policy.  |
| Tracking pixels must be removed while remote images remain accepted.     | Select one explicit image/privacy policy and test that actual behavior.                              |
| Added columns make old-code rollback safe.                               | Preserve source-type isolation, sync filters, and address reservations throughout rollback.          |

Repository evidence and official documentation were inspected for this assessment. No new feature code, migration, runtime test, live SMTP delivery, DNS change, or cloud deployment is claimed here. The earlier OpenSpec validation result was a structural check of the earlier artifacts, not verification of this revised design.
