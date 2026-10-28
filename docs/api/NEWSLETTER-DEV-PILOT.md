# Newsletter subaddress rollout and dev acceptance

OpenSpec: `support-newsletter-feed`. Selected format and REST-first rollout confirmed by the user on 2026-10-27; this supersedes the unshipped root-domain pilot and earlier Newsletter PowerSync plan.

## Address and activation policy

| Installation | User address | Cloudflare literal route | Operational rollout |
| --- | --- | --- | --- |
| Dev | `feed+<account>@newsletterreader.slax.dev` | `feed@newsletterreader.slax.dev` | Enabled after deployment readiness |
| Beta / production | `feed+<account>@newsletterreader.slax.com` | `feed@newsletterreader.slax.com` | Domain preconfigured; receiving route follows production readiness |

The application supplies the fixed `feed+` prefix; `NEWSLETTER_DOMAIN` contains only the receiving domain. Cloudflare Subaddressing matches every `feed+detail` to the one literal `feed` route and preserves the complete recipient in `message.to`. The Worker validates the full envelope domain and prefix, then resolves the permanent account token, active user and Newsletter Lab. Bare `feed`, empty/unknown details, another prefix, additional plus separators and foreign domains are rejected before content storage. Header To never controls ownership. A new Reader user needs no additional Cloudflare rule.

The dev Edge Worker is **reader-backend**, serving **reader-api.slax.dev**. The private dev Web configuration points to **https://r.slax.dev**; verify the actual deployed URL. Receiving domain selection does not change those service hostnames.

`feed+daguang@newsletterreader.slax.com` is separate from the existing `daguang@slax.app` forwarding address. No global daguang account ban is needed in the selected namespace. Preserve slax.app routing and forwarding. Root slax.com continues using Feishu; its MX records must remain intact. Keep slax.dev Catch-all unchanged (previously Drop / Active). No root-domain Catch-all change is part of this rollout.

## Release readiness

1. Review and merge private configuration PR #7 before application PR #349. Dev: `NEWSLETTER_DOMAIN="newsletterreader.slax.dev"`. Remove `NEWSLETTER_ENABLED`. As requested by the user on 2026-10-28, beta/prod and the legacy main copy already set `NEWSLETTER_DOMAIN="newsletterreader.slax.com"`, avoiding a later domain-only configuration PR. This supersedes the earlier empty-domain pilot gate. Matching deployment permits user-Lab address provisioning; it does not create Cloudflare DNS or routing. Deployment uses `--keep-vars`: rollback must explicitly clear a domain rather than omit it. Main releases consume `api/prod.toml`. Config merge alone does not deploy.
2. Merge the reviewed application PR into dev. Wait for **both API and Web deployments**. Verify the consolidated first-release `20261022090000_newsletter_feed` migration, matching dev Edge/Core PostgreSQL/R2 bindings, generated routes/DI and the Edge `email()` handler. Preserve Worker identities and existing shared scheduled triggers; the email event awaits publication. Newsletter has no scheduled recovery or temporary-body staging. Keep the Cloudflare five-minute trigger because other jobs still use it; removing recoverNewsletter does not authorize removing shared schedules.
3. RSS tables, APIs and PowerSync rules are unchanged by Newsletter. No Newsletter-related PowerSync publication is required. Continue deploying upstream collection/PowerSync changes through their existing process.
4. Enable Newsletter in Labs for one or two controlled dev users, generate/copy their addresses and verify the exact `feed+...@newsletterreader.slax.dev` format before routing external mail.

The `newsletter` platform binding permanently stores the complete canonical address. Account renames do not change it. Eligible initial tokens are 1–59 safe ASCII characters; the fixed `feed+` consumes five SMTP local-part octets. Enable through `/v1/user/setting/enable` (`key: lab:newsletter`); plain activation only enables the Lab. In Feed, preview the complete address and confirm its permanent assignment. Confirmed creation sends the same endpoint an explicit `newsletter_address`; cancellation performs no account or binding writes. Missing, invalid or reserved accounts remain repairable beside the input. Read-only `/v1/user/newsletter_address` never provisions, and its old POST is removed.

Newsletter has not shipped. Its consolidated initial migration creates only `sr_newsletter_feed`, alongside a partial unique index for Newsletter receiving addresses on the existing sr_platform_bind table. No binding columns or triggers are added. Account deletion uses existing sr_user.deleted_at, and cleanup retains the Newsletter binding row to reserve the address. One mail row covers admission, deduplication, pending/ready/cancelled state and the final body pointer. There is no `sr_feed`, receipt table, RSS mirror, data copy/backfill or processing lease. Use a fresh disposable local database when an older trial migration has already been applied; no compatibility or repair migration is provided.

The first release accepts only its configured feed+ address format. External subscriptions must use the current copied address. Normal address provisioning preserves an issued address; changing a receiving domain later requires a separate migration plan rather than silently replacing bindings.

## Dev Cloudflare console steps

After API/Web deployment readiness:

1. Open the **slax.dev** zone, then **Compute → Email Service → Email Routing → Settings** (older navigation may omit Compute). Record existing routes, Catch-all and Subaddressing state first.
2. Under **Subdomains**, add `newsletterreader` if it is not already configured for receiving. Cloudflare adds the required DNS records to **newsletterreader.slax.dev**. Wait for its DNS checks to become healthy. This is receiving configuration, not Email Sending onboarding; do not replace root MX or unrelated DNS records.
3. Enable **Subaddressing** in Email Routing Settings. It affects routing rules in the zone, so inventory existing uses before changing it. Cloudflare explicitly defined plus-detail rules take precedence over the base route; verify no existing rule intercepts either test user's address.
4. In **Routing Rules**, create or edit this single rule:

   | Field | Value |
   | --- | --- |
   | Local part / email pattern | `feed` |
   | Domain | `newsletterreader.slax.dev` |
   | Action | Send to a Worker |
   | Destination | reader-backend |
   | Status | Active |

The first two fields compose **feed@newsletterreader.slax.dev**; “complete address” is an example, not a separate Dashboard control. If **reader-backend** is absent with **Send to a Worker** selected, first confirm the matching dev deployment includes its exported `email()` handler, is in the same Cloudflare account, and has completed successfully. The new handler is part of application PR #349; an older deployed HTTP-only Worker may not be eligible. Reopen the selector after deployment; if still absent, inspect the deployed Worker and console/API error rather than selecting another environment.

5. Do **not** enter literal `feed+account`, `feed+*` or `*@newsletterreader.slax.dev`. Do not create one rule per user. Subdomain Catch-all is not supported in this setup; the base literal rule plus Subaddressing supplies uniform routing.
6. Confirm no missing-Worker warning. Keep root Catch-all and unrelated literal routes unchanged. Open Email Routing Activity and Worker observability for acceptance; never add private mailbox/body/tracking data to application logs.

Cloudflare documents the [subdomain receiving workflow](https://developers.cloudflare.com/email-service/configuration/subdomains/) and [Subaddressing matching, settings and detail preservation](https://developers.cloudflare.com/email-service/configuration/email-routing-addresses/#subaddressing). SMTP local-part size is specified in [RFC 5321 §4.5.3.1.1](https://www.rfc-editor.org/rfc/rfc5321#section-4.5.3.1.1).

## Human dev test sequence

Use two Reader accounts you control, with distinct short safe account names such as newsletter-alice and newsletter-bob. Use the exact copied address, including the plus.

| Step | Action | Expected result |
| --- | --- | --- |
| 1 | With both Labs off, open Feed; then enable Newsletter | Feed stays visible, shows setup guidance, then shows setup without creating an address, including for an existing valid Reader account. |
| 2 | Generate/copy addresses for A and B, refresh and provision again | Each has its own `feed+account@newsletterreader.slax.dev`; repeated provisioning preserves its address. |
| 3 | Send ordinary mail with a unique title to A, then reload the Feed page | One sender source and entry appear in A's Feed; Inbox is unchanged. Activity should show the complete plus recipient. |
| 4 | Send another message from the same sender to B, then reload | B sees B's message; A's content is inaccessible to B. Both addresses use the one literal Cloudflare route. |
| 5 | Send to `feed+<unique-unregistered-token>@newsletterreader.slax.dev`, then bare `feed@newsletterreader.slax.dev` | The base route invokes the Worker, which rejects both without storing mail rows. Check Activity and the sender's eventual status. |
| 6 | Send to a wrong prefix such as `r+<A-token>@newsletterreader.slax.dev` | It must not enter A's Feed. Without a matching literal route Cloudflare may reject it before invoking the Worker. Local injection separately proves the Worker also rejects it. |
| 7 | Send plain text, HTML and multipart mail containing a link and attachment | Safe body is readable, links work, scripts do not execute, and binary attachments show safe filenames and a not-stored explanation; existing HTTP(S) download links remain, CID images are omitted, and explicit tiny/hidden tracking images are removed before sanitization. Remote images use the signed proxy; the origin may observe its first proxy fetch. |
| 8 | Subscribe A and B to the same real Newsletter and complete confirmation | Both confirmation and actual content arrive independently. Retiring A's external subscription does not affect B. Try team-relevant Substack, beehiiv, Kit, Mailchimp or MailerLite sources. Valid syntax alone does not prove every platform accepts plus addresses. |
| 9 | Enable RSS, then disable/re-enable each Lab separately | Newsletter on: the whole Feed reads `/v1/feed/subscriptions`, `/v1/feed/entries` and authenticated bodies through REST, including with a healthy local database. Newsletter off and RSS on: existing RSS local-first resumes. Switching clears obsolete previews/cursors; other accounts and stale local Newsletter rows never appear. RSS management/Save to Inbox remain unchanged. Newsletter saving creates an independent Inbox copy. Disabled Newsletter delivery is rejected; completed old entries return on re-enable/reload. |
| 10 | Change A's account/display name; send to A's original issued address | Original token/address stays bound and continues delivering to A. |
| 11 | Check phone, 768px and desktop; light/dark/eink and keyboard | The full plus address, copy control, sources and body remain usable without overflow. |

Newsletter arrival does not push a local list update in this version: reload the page after delivery, or use an existing explicit refresh action that revalidates REST. Source switching may reuse the per-source in-memory cache for up to 60 seconds; an online page reload starts fresh. RSS and Newsletter share one server ordering/cursor whenever Newsletter is on. Load more, source switching, slow responses and account changes should retain the correct rows without duplicates or stale bodies. No new-session offline Newsletter list/body availability is promised. Bookmark and collection PowerSync continue independently.

A new composed message or manual forward normally gets a new Message-ID and should be a new entry. Deduplication requires replaying the same raw message and Message-ID. Limits remain 5 MiB per raw email including MIME/base64 overhead, 200 sources per user and 200 newly admitted messages per UTC day. Begin with one or two users and monitor backlog age/storage. Do not disrupt shared dev infrastructure to force failures.

## Repeatable local checks

```sh
pnpm api -- test
pnpm api -- typecheck
SLAX_API_CONFIG=deploy/cloudflare/api.toml.example pnpm api -- build edge
pnpm exec openspec validate --all --strict
pnpm api -- test:http
NEWSLETTER_SMOKE_DOMAIN=newsletterreader.slax.com pnpm api -- test:http
```

The smoke harness creates disposable PostgreSQL/logs databases, applies historical migrations and runs actual local Edge/Core with D1/R2, then cleans up only its resources. It verifies full prefixed rendering, mixed-case envelope handling, malformed/foreign rejection before mail rows, two-user isolation, deduplication, sanitized body reads and existing auth/bookmark flows. The harness verifies settings enable plus pure address GET, direct BIGINT mail IDs and platform-only binding ownership, and the EML replay command with an encoded plus recipient. It does not send real email.

If the isolated Corepack home cannot download the pinned package manager, prepare its public distribution archive:

```sh
corepack pack pnpm@11.25.0 -o /tmp/slax-newsletter-pnpm.tgz
pnpm api -- test:http --corepack-archive /tmp/slax-newsletter-pnpm.tgz
NEWSLETTER_SMOKE_DOMAIN=newsletterreader.slax.com pnpm api -- test:http --corepack-archive /tmp/slax-newsletter-pnpm.tgz
```

When constructing local injection URLs manually, encode `+` as `%2B` in query parameters (or use URLSearchParams/encodeURIComponent); an unescaped plus is interpreted as a space. Do not URL-decode `message.to` again inside the Worker. Local injection bypasses Cloudflare routing, so it does not prove base-rule matching, DNS, Subaddressing, real SMTP or external platform acceptance. See [validation.md](../../openspec/changes/support-newsletter-feed/validation.md) for evidence and gaps.

## Rollback and future production

To stop, disable/restore the pilot's **literal feed@newsletterreader.slax.dev route** and explicitly clear `NEWSLETTER_DOMAIN` through the maintained config/release path (an omitted variable may survive `--keep-vars`). Preserve existing Catch-all/unrelated literal rules. Do not globally disable Subaddressing if another route relies on it. Keep schema, completed content and all permanent reservations; disabling routing does not buffer mail for later replay.

Production domain values are preconfigured. Before enabling controlled production user Labs or activating its literal receiving route, verify the independent Newsletter schema, live user authorization and ordinary account-default bookmark sharing. Production receiving rollout uses newsletterreader.slax.com DNS, Subaddressing and **feed@newsletterreader.slax.com** to the verified production Edge Worker. Keep root slax.com Feishu MX and daguang@slax.app forwarding intact. Only operate the selected subdomain; do not repoint the old broken slax.app Catch-all as part of this plan.

Before widening the pilot, finish the unchanged RSS regression checks, real Newsletter confirmation/content tests and SMTP infrastructure-failure behavior. Subscribed bodies are not pruned by RSS's 30-day rule. Binary attachment storage and automatic unsubscribe remain out of scope. Newsletter Save to Inbox is included as an independent private copy.

## Private EML preview and local replay

### Local setup-card acceptance

1. Sign in at http://localhost:3000 and enable Newsletter in Labs. A user without an issued binding should see a setup form in Feed; enabling the Lab must not create a mailbox.
2. Enter a valid account and check the full lowercase `feed+account@newsletterreader.slax.dev` candidate. Create opens a second confirmation explaining that the address is permanent and, if necessary, that the Reader account will be set too. Return or Escape before submitting keeps the draft and makes no writes.
3. Use another test user's existing account to check the inline taken warning. An address retained for another binding shows a reservation warning instead. Enter a free account to clear the warning, confirm, and check waiting feedback, the final address and copy action. Avoid changing a real operator's account just to trigger a test case.
4. Collapse the card, refresh and verify that title, full address, copy and permanent status remain. Expand to see the stronger permanence notice and muted receiving details. A different signed-in user has an independent preference. Check Chinese/English and light/dark/e-ink at phone, 768px and desktop widths.
5. An already issued address deliberately has no create form. Use a new local test identity to exercise first creation; no database reset or compatibility migration is needed for this UI revision. Continue the EML receive/read/save checks below with the copied address.

### Local runtime configuration

Run from the Newsletter worktree. The default `pnpm api -- dev` reads the ignored `deploy/local/api.toml`, selecting `[env.dev]` when that environment exists. Set the receiving domain in the effective variables table: `[env.dev.vars]` for the current local bundle, or `[vars]` only when no named environment is selected. Native Wrangler environment variables are not inherited from the top-level table.

```toml
[env.dev.vars]
NEWSLETTER_DOMAIN = "newsletterreader.slax.dev"
```

Add the key to the existing table, without replacing its other settings. The private configuration repository's `api/dev.toml` is used by deployment; local startup does not automatically load that file. After changing local API configuration, run `pnpm api -- gen:all`, stop the existing API dev session and restart `pnpm api -- dev`. Keep only one local API session. Run `pnpm web -- dev` separately if Web is not already running, then open http://localhost:3000.

With a missing/invalid effective domain, address GET returns HTTP 200 with `data.status=unavailable` and `data.domain=null`; confirmed creation returns HTTP 503 with `data.error=unavailable`. Plain Lab activation does not provision an address and does not require the domain to be ready. After fixing configuration and restarting the API, refresh Web; if the Lab is already on, generate the address from Feed. Changing an issued address's domain also fails instead of replacing its existing binding. No Cloudflare routing or DNS change is needed for local replay.

### Preview and delivery

Keep real EML outside Git. Preview performs no DB, R2 or network/image requests and creates owner-only files with an external-resource-blocking CSP:

```sh
pnpm api -- newsletter:test --mode preview --eml "/absolute/path/sample.eml" --out /tmp/newsletter-preview
```

For a path containing spaces or an apostrophe, wrap the whole path in double quotes and do not also backslash-escape those characters.

Open `newsletter.html`, compare `newsletter.txt` to the original, and inspect `report.json` for attachment metadata, removed tracker count, extraction fallback and truncation. The report contains private subject/sender data; do not publish it. Preview intentionally blocks all remote images, so it validates structure and extraction rather than remote image display.

With the operator-configured local API/Web running and a copied local account address:

```sh
pnpm api -- newsletter:test --mode deliver --eml "/absolute/path/sample.eml" --edge http://localhost:8787 --to 'feed+account@newsletterreader.slax.dev' --repeat 2
```

Use the actual local Edge port. Delivery is localhost-only, sends the original bytes through Wrangler `/cdn-cgi/local/email`, preserves plus details and rejects redirects. Replaying one Message-ID should produce one entry; changed Message-ID should produce another. This is not a production debug endpoint or SMTP test. Compare local Feed subject/body/links/attachment explanation and verify normal images use the signed proxy while filtered trackers never reach it.

## Failure handling without automatic recovery

The user deferred recoverNewsletter on 2026-10-28. The incoming event parses MIME and awaits final Feed HTML storage plus database publication. No original EML, attachment binaries or temporary replay JSON is stored; no Newsletter recovery cron, scan or staging GC exists. Existing shared scheduled jobs remain, with no Newsletter-specific scheduled task or body scan. The user also deferred orphan-body collection; interrupted writes, indeterminate publication outcomes or failed deletes can leave unreferenced R2 objects until a later iteration. Immediate discard of a known unpublished candidate and normal account-deletion cleanup remain.

A processing failure propagates and leaves the mail pending. Each delivery can attempt its own immutable content object; only one atomic publication wins. Publication is bounded to five minutes and disabling/deleting cancels pending mail. Only another actual email delivery or explicit local EML replay supplies the content and attempts processing again. Ready/cancelled duplicates are no-ops; disabling/deleting still fences in-flight publication. No background process guarantees eventual delivery.

The path is sender → Cloudflare receiving MX → rule → Worker. Cloudflare documents setReject() as a permanent SMTP error, but does not guarantee that every arbitrary Worker exception/restart causes the original sender to retry. Do not claim that removing automatic recovery proves natural retries. Real SMTP failure/retry behavior remains a separate hosted acceptance item, not a prerequisite blocking this user-approved simplification.

The unmerged initial feature migration is edited directly, without adding a cleanup migration. An operator database that already applied the older SQL will have different migration checksums/columns; use a fresh isolated development database or an explicitly agreed local repair before testing this version. Existing raw trial-stage objects are not scanned by current code. This revision does not reset/repair the active local database or delete its existing mail.

Sources: [Cloudflare email handler](https://developers.cloudflare.com/email-service/api/route-emails/email-handler/) and [RFC 5321 §4.2.5](https://www.rfc-editor.org/rfc/rfc5321#section-4.2.5).

## RSS Save to Inbox storage behavior

RSS Feed HTML is cached under `rss-content/`. Saving an unsaved URL creates/restores a user bookmark and dispatches the normal crawl workflow. Successful acquisition writes independent private HTML and text snapshot objects, normally `html/body/<uuid>.html` and `text/body/<uuid>.txt`. It does not reuse the Feed content key. Feed and bookmark HTML may differ because feeds can contain an excerpt while the crawler fetches the full article. Existing successful same-user/same-URL bookmarks are reused rather than copied on every click.

## Newsletter Save to Inbox

Save from either a mail row or its preview; a public article URL is not required. The API copies sanitized received HTML into `html/body/<uuid>.html`, derives `text/body/<uuid>.txt`, embeds the standard HTML snapshot manifest, then publishes a successful owner-isolated bookmark and relation in one transaction. New copies follow the current account-default sharing setting with no Newsletter-specific share override. The global sharing setting is unchanged. Repeated saving reuses that user's successful copy; restoring from Trash preserves its annotations and explicit sharing choices. No web crawl or AI moderation runs again. Index/cache effects run after commit and a repeat save retries indexing without replacing content. Indexing failure does not undo the saved copy.

The original remains under `newsletter-content/`; its key is never used as the bookmark pointer. Images keep the signed proxy URLs, and binary attachments remain names/explanations. Disabling Newsletter hides Feed mail but the saved Inbox copy stays readable. Saving a different message creates a different copy even when both messages have no external URL. Generic URL acquisition and refresh reject the internal `slax-newsletter:` identity.

Acceptance: save a mail from list and preview; open the saved route from Inbox; confirm readable body, attachments, tagging/highlighting/star/archive, account-default sharing on/off, and anonymous/other-user access matching that setting or an explicit single-bookmark override. Repeat save and restore from Trash must keep the same UUID and annotations. Switch accounts and disable Newsletter during a slow response to check stale state is ignored. Check RSS-only local state, refresh/history and saving still work as before. Remote SMTP retries, real Newsletter platform signup and hosted routing remain separate dev checks.
