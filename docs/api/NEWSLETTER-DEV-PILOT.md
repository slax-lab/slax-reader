# Newsletter root-domain rollout and dev acceptance

OpenSpec: `support-newsletter-feed`. Approved routing revision: 2026-10-27.

## Address and activation policy

| Installation | Receiving address | Admission in the dev-first rollout |
| --- | --- | --- |
| Dev | `<account>@slax.dev` | Enabled after deployment readiness |
| Beta / production | `<account>@slax.app` | Explicitly disabled until separate acceptance |

Use one root-domain Email Routing Catch-all per installation. Individual users do not need Cloudflare rules or a plus-address prefix. Reader checks the exact envelope domain, permanent address binding, active user and Newsletter Lab before storing mail. Unknown, disabled and retired recipients are rejected; Catch-all does not make them Reader mailboxes.

The dev Edge Worker is **reader-backend**, with **reader-api.slax.dev** in Domains & Routes. The private dev configuration currently identifies the Web frontend as **https://r.slax.dev**; verify the deployment URL before testing. Newsletter suffix selection does not change API or Web hostnames.

Production has an active `daguang@slax.app` forwarding rule and a Catch-all pointing to missing Worker `slax-read-backend`, as reported by the operator. Preserve the literal forwarding rule. Application policy reserves the full business address, case-insensitively: GET/POST return `address_reserved`, and Newsletter recipient lookup refuses it even with a stale registry row. `daguang@slax.dev` remains eligible. An already issued different address survives a later account rename to daguang. Any additional business mailbox requires a corresponding reservation review before enabling routing for that namespace.

Do not change slax.com MX records: that domain continues using Feishu. Production is not activated by this dev-first change. The missing old Worker name must not be reused as an assumed deployment target.

## Release readiness before console changes

1. Review and merge the private configuration PR first. Dev sets `NEWSLETTER_ENABLED="true"`, `NEWSLETTER_DOMAIN="slax.dev"`; beta/prod and the legacy main copy set `NEWSLETTER_ENABLED="false"`, `NEWSLETTER_DOMAIN="slax.app"`. Main application releases load `api/prod.toml`, not the legacy `api/main.toml`. Configuration merge alone does not deploy. No new runtime variable or receiving secret is needed.
2. Merge the application PR into dev when reviewed. Wait for **both API and Web deployment success**; they run independently. Confirm migration `20261022090000_newsletter_feed` and generated routes/DI are present, and Edge/Core use the matching dev PostgreSQL and R2 resources. Preserve Worker identities, service bindings and existing scheduled triggers.
3. Publish `deploy/local/powersync-local/sync_rules.yaml` to the matching dev PowerSync service using its operator workflow. This publication is separate from API deployment. Verify RSS-only `rss_v1` and disjoint `newsletter_v1`; old RSS projection columns stay compatible. A healthy REST Feed alone does not prove hosted sync acceptance.
4. In Workers & Pages, confirm **reader-backend** still serves **reader-api.slax.dev**, contains the new `email()` handler, and shares the required dev storage with Core. Confirm the existing scheduled trigger includes `*/5 * * * *`; do not add a duplicate. Recovery claims at most five pending receipts per tick, so start with one or two users and monitor pending age.
5. Enable Newsletter in dev Labs for one or two test users. Open Feed, set a valid ASCII account if needed, generate the receiving address and verify the suffix is exactly `@slax.dev` before routing external mail.

Existing addresses issued under a previous test domain do not automatically migrate or become aliases. Preserve their registry reservations and stored content; provision/copy the new-domain address and update external subscriptions that used an old address. Do not rewrite registry ownership to make an old subscription appear migrated.

Use the established pipeline in [DEV-AND-CI-EN.md](DEV-AND-CI-EN.md). No remote migration, deployment, PowerSync publication or Cloudflare route mutation is performed by merely updating these PRs.

## Dev Cloudflare console actions

Perform these steps only after the readiness checks pass:

1. Open **slax.dev → Email Service → Email Routing → Routing Rules** (the account navigation may show **Compute → Email Service**). Record the existing rules and the current Catch-all action; the operator previously confirmed **Drop / Active**.
2. Preserve every existing literal rule. Check that neither test user's address is intercepted by a different literal route.
3. Edit **Catch-all**: choose **Send to a Worker**, destination **reader-backend**, and enable/save it so it shows **Active** without a missing-Worker warning.
4. Do not create one address rule per user. No receiving subdomain, plus-address feature or new MX record is required for this root-domain design when the existing Email Routing DNS checks are healthy.
5. Open Email Routing activity and Worker observability while testing. Record delivery/rejection outcomes and invocation failures; do not add mailbox addresses, raw bodies or tracking URLs to application logs.

Cloudflare evaluates specific recipient rules before Catch-all when none match, as documented in its [inbound email lifecycle](https://developers.cloudflare.com/email-service/concepts/email-lifecycle/#inbound-flow-email-routing). See also [routing rules and Catch-all](https://developers.cloudflare.com/email-service/configuration/email-routing-addresses/#catch-all-rule) and the [email handler](https://developers.cloudflare.com/email-service/api/route-emails/email-handler/).

## Dev test sequence

Use two accounts you control. Create distinct plain ASCII account names such as `newsletter-alice` and `newsletter-bob`; use the exact addresses displayed by Feed.

| Step | Action | Expected result |
| --- | --- | --- |
| 1 | Open Feed with both Labs off | Feed remains visible with setup guidance and no disabled content. |
| 2 | Enable Newsletter and generate/copy addresses for both users | Each gets its own `<account>@slax.dev`; repeated provisioning returns the same address. |
| 3 | Send an ordinary email from a mailbox you control to user A | One Newsletter sender source and one readable entry appear in A's Feed; Inbox is unchanged. |
| 4 | Send from the same sender to user B | B sees only B's message; A's content is not visible through B's Feed or entry API. |
| 5 | Send to a unique unprovisioned address under slax.dev | Catch-all invokes the Worker, which rejects it; no receipt, body or Feed entry is created. Check activity and the sender's eventual status. No temporary literal route is needed. |
| 6 | Send HTML, plain text and multipart mail with a link and attachment | Safe text is readable, no scripts execute, attachments/CID resources are omitted. |
| 7 | Open a message with a remote image | The browser uses the signed image proxy. The image source may observe its first proxy fetch. |
| 8 | Subscribe the two addresses to the same representative Newsletter | Confirmation and actual content arrive independently. Retiring one external subscription must not affect the other. Begin with Substack, beehiiv, Kit, Mailchimp or MailerLite sources relevant to the team. |
| 9 | Enable RSS and add a working RSS source | RSS and Newsletter coexist. RSS management and Save to Inbox remain RSS-only. |
| 10 | Change A's account/display name and send to A's original issued address | The displayed issued address stays fixed and mail still reaches A. A new account-derived address is not silently substituted. |
| 11 | Disable Newsletter for A and send again; then re-enable | Delivery while disabled is rejected, RSS stays readable, old completed entries return on re-enable and cancelled pending work does not resume. |
| 12 | Disable RSS, reload and re-enable | Newsletter stays readable and RSS content follows its own switch. |
| 13 | Check phone, 768px and desktop widths plus light/dark/eink and keyboard | Existing address, source and reader controls remain usable. |

An ordinary new message or manual forward usually has a new Message-ID and should create a new entry. Test duplicate suppression by replaying the same raw email and Message-ID through the isolated harness below, rather than assuming two composed emails deduplicate. Raw mail is limited to 5 MiB including MIME/base64 overhead; source/day limits are 200 sources per user and 200 new admitted messages per UTC day.

The `daguang@slax.app` reservation is verified locally in the production-domain simulation. Do not change dev's configured domain to slax.app or send a live production test while production admission remains disabled. `daguang@slax.dev` is intentionally not reserved; only exercise it if that dev account belongs to the tester and has no pre-existing conflicting route.

## API contract and repeatable local verification

Authenticated address GET is side-effect free; POST is idempotent. Both return the existing structured `address_reserved` error with code 409 for the production business address. Existing UI handles this error with account recovery guidance. No API DTO, Vue presentation or new translation is introduced by the routing revision. Feed APIs continue enforcing ownership, enabled kinds and private no-store responses. See `packages/contracts/src/feed.ts`.

From the repository root:

```sh
pnpm api -- test
pnpm api -- typecheck
SLAX_API_CONFIG=deploy/cloudflare/api.toml.example pnpm api -- build edge
pnpm exec openspec validate --all --strict
pnpm api -- test:http
NEWSLETTER_SMOKE_DOMAIN=slax.app pnpm api -- test:http
```

The HTTP smoke creates disposable local PostgreSQL/logs databases, applies historical migrations, runs actual Edge/Core Workers and local D1/R2, and removes its own resources afterwards. Default simulation uses slax.dev and verifies daguang remains available. The slax.app simulation verifies business-address GET/POST rejection, stale-binding refusal and mixed-case envelope rejection, then normal delivery, deduplication, Feed body reads and existing bookmark smoke flows. Neither run contacts a real mailbox or changes hosted services.

If the isolated Corepack home cannot download the pinned package manager, prepare a public cache archive and supply it to both commands:

```sh
corepack pack pnpm@11.25.0 -o /tmp/slax-newsletter-pnpm.tgz
pnpm api -- test:http --corepack-archive /tmp/slax-newsletter-pnpm.tgz
NEWSLETTER_SMOKE_DOMAIN=slax.app pnpm api -- test:http --corepack-archive /tmp/slax-newsletter-pnpm.tgz
```

See the [validation record](../../openspec/changes/support-newsletter-feed/validation.md) for tests actually run, previous human UI acceptance and remaining live acceptance gaps. Local email injection does not verify Cloudflare Catch-all, external SMTP, sender retries or hosted PowerSync.

## Stop and future production rollout

To stop the dev pilot, restore its previous **Catch-all → Drop** action and disable admission with `NEWSLETTER_ENABLED="false"` through the maintained private configuration/release path. Also inspect any pilot-specific literal rules left from earlier testing: restoring Catch-all does not disable those routes. Drop discards new mail; it is not buffering for later recovery. Keep schema, completed content and permanent address reservations.

Production remains disabled until all serving releases and sync rules sharing PostgreSQL have RSS-kind isolation. At its separate rollout, identify the actual production Edge Worker, preserve the active daguang literal forwarding rule and its destination, and bind the broken slax.app Catch-all to the ready production Worker. Verify both the existing business forwarding and two-user Newsletter delivery. Keep business mailbox names reserved when adding future literal routes. No slax.com mail configuration changes are needed.

Subscribed Newsletter bodies are not pruned by the RSS 30-day policy. Before expanding beyond the small dev pilot, validate real SMTP outcomes on pre-admission infrastructure failures, hosted PowerSync isolation, pending-receipt recovery age and storage growth. Do not disrupt shared dev storage to force failures. Attachments, automatic unsubscribe and saving Newsletter to Inbox remain out of scope.
