# Newsletter subaddress rollout and dev acceptance

OpenSpec: `support-newsletter-feed`. Selected format confirmed by the user on 2026-10-27; this supersedes the unshipped root-domain pilot.

## Address and activation policy

| Installation | User address | Cloudflare literal route | Initial admission |
| --- | --- | --- | --- |
| Dev | `feed+<account>@newsletterreader.slax.dev` | `feed@newsletterreader.slax.dev` | Enabled after deployment readiness |
| Beta / production | `feed+<account>@newsletterreader.slax.com` | `feed@newsletterreader.slax.com` | Explicitly disabled during dev acceptance |

The application supplies the fixed `feed+` prefix; `NEWSLETTER_DOMAIN` contains only the receiving domain. Cloudflare Subaddressing matches every `feed+detail` to the one literal `feed` route and preserves the complete recipient in `message.to`. The Worker validates the full envelope domain and prefix, then resolves the permanent account token, active user and Newsletter Lab. Bare `feed`, empty/unknown details, another prefix, additional plus separators and foreign domains are rejected before raw storage. Header To never controls ownership. A new Reader user needs no additional Cloudflare rule.

The dev Edge Worker is **reader-backend**, serving **reader-api.slax.dev**. The private dev Web configuration points to **https://r.slax.dev**; verify the actual deployed URL. Receiving domain selection does not change those service hostnames.

`feed+daguang@newsletterreader.slax.com` is separate from the existing `daguang@slax.app` forwarding address. No global daguang account ban is needed in the selected namespace. Preserve slax.app routing and forwarding. Root slax.com continues using Feishu; its MX records must remain intact. Keep slax.dev Catch-all unchanged (previously Drop / Active). No root-domain Catch-all change is part of this rollout.

## Release readiness

1. Review and merge private configuration PR #7 before application PR #349. Dev: `NEWSLETTER_ENABLED="true"`, `NEWSLETTER_DOMAIN="newsletterreader.slax.dev"`. Beta/prod and the legacy main copy: `NEWSLETTER_ENABLED="false"`, `NEWSLETTER_DOMAIN="newsletterreader.slax.com"`. Main releases consume `api/prod.toml`. Config merge alone does not deploy.
2. Merge the reviewed application PR into dev. Wait for **both API and Web deployments**. Verify additive migration `20261022090000_newsletter_feed`, matching dev Edge/Core PostgreSQL/R2 bindings, generated routes/DI and the Edge `email()` handler. Preserve Worker identities and existing scheduled triggers; recovery uses the existing five-minute tick, with at most five pending receipts per tick.
3. Publish `deploy/local/powersync-local/sync_rules.yaml` to the matching hosted dev PowerSync service through its operator workflow. API deployment does not publish these rules. Verify RSS-only `rss_v1` and disjoint `newsletter_v1`; a working REST fallback does not prove hosted synchronization.
4. Enable Newsletter in Labs for one or two controlled dev users, generate/copy their addresses and verify the exact `feed+...@newsletterreader.slax.dev` format before routing external mail.

The stable registry stores the original canonical account token in `local_part`; rendering adds `feed+`. It does not derive a new token after a user rename. Eligible account tokens are 1–59 safe ASCII characters, because `feed+` uses five of the SMTP local part's 64 octets. Global account rules are unchanged. A 60-character account is rejected for Newsletter without truncation. An oversized legacy stored token remains reserved and needs operator remediation; it is not silently rewritten.

The approved format/domain transition changes old test addresses. Old unprefixed, root-domain or different-prefix mailboxes are not automatic aliases. Preserve registry ownership and existing content, provision/copy the new address and update external subscriptions. Do not repurpose another user's reservation to make an old subscription appear migrated.

## Dev Cloudflare console steps

After deployment and sync readiness:

1. Open the **slax.dev** zone, then **Compute → Email Service → Email Routing → Settings** (older navigation may omit Compute). Record existing routes, Catch-all and Subaddressing state first.
2. Under **Subdomains**, add `newsletterreader` if it is not already configured for receiving. Cloudflare adds the required DNS records to **newsletterreader.slax.dev**. Wait for its DNS checks to become healthy. This is receiving configuration, not Email Sending onboarding; do not replace root MX or unrelated DNS records.
3. Enable **Subaddressing** in Email Routing Settings. It affects routing rules in the zone, so inventory existing uses before changing it. Cloudflare explicitly defined plus-detail rules take precedence over the base route; verify no existing rule intercepts either test user's address.
4. In **Routing Rules**, create or edit this single rule:

   | Field | Value |
   | --- | --- |
   | Local part / email pattern | `feed` |
   | Domain | `newsletterreader.slax.dev` |
   | Complete literal address | `feed@newsletterreader.slax.dev` |
   | Action | Send to a Worker |
   | Destination | reader-backend |
   | Status | Active |

5. Do **not** enter literal `feed+account`, `feed+*` or `*@newsletterreader.slax.dev`. Do not create one rule per user. Subdomain Catch-all is not supported in this setup; the base literal rule plus Subaddressing supplies uniform routing.
6. Confirm no missing-Worker warning. Keep root Catch-all and unrelated literal routes unchanged. Open Email Routing Activity and Worker observability for acceptance; never add private mailbox/body/tracking data to application logs.

Cloudflare documents the [subdomain receiving workflow](https://developers.cloudflare.com/email-service/configuration/subdomains/) and [Subaddressing matching, settings and detail preservation](https://developers.cloudflare.com/email-service/configuration/email-routing-addresses/#subaddressing). SMTP local-part size is specified in [RFC 5321 §4.5.3.1.1](https://www.rfc-editor.org/rfc/rfc5321#section-4.5.3.1.1).

## Human dev test sequence

Use two Reader accounts you control, with distinct short safe account names such as newsletter-alice and newsletter-bob. Use the exact copied address, including the plus.

| Step | Action | Expected result |
| --- | --- | --- |
| 1 | With both Labs off, open Feed; then enable Newsletter | Feed stays visible, shows setup guidance, then allows generating the receiving address. |
| 2 | Generate/copy addresses for A and B, refresh and provision again | Each has its own `feed+account@newsletterreader.slax.dev`; repeated provisioning preserves its address. |
| 3 | Send ordinary mail with a unique title to A | One sender source and entry appear in A's Feed; Inbox is unchanged. Activity should show the complete plus recipient. |
| 4 | Send another message from the same sender to B | B sees B's message; A's content is inaccessible to B. Both addresses use the one literal Cloudflare route. |
| 5 | Send to `feed+<unique-unregistered-token>@newsletterreader.slax.dev`, then bare `feed@newsletterreader.slax.dev` | The base route invokes the Worker, which rejects both without storing receipts or entries. Check Activity and the sender's eventual status. |
| 6 | Send to a wrong prefix such as `r+<A-token>@newsletterreader.slax.dev` | It must not enter A's Feed. Without a matching literal route Cloudflare may reject it before invoking the Worker. Local injection separately proves the Worker also rejects it. |
| 7 | Send plain text, HTML and multipart mail containing a link and attachment | Safe body is readable, links work, scripts do not execute, and attachments/CID resources are omitted. Remote images use the signed proxy; the origin may observe its first proxy fetch. |
| 8 | Subscribe A and B to the same real Newsletter and complete confirmation | Both confirmation and actual content arrive independently. Retiring A's external subscription does not affect B. Try team-relevant Substack, beehiiv, Kit, Mailchimp or MailerLite sources. Valid syntax alone does not prove every platform accepts plus addresses. |
| 9 | Enable RSS, then disable/re-enable each Lab separately | Both types coexist; switches and RSS management/Save to Inbox remain isolated. Disabled Newsletter delivery is rejected; completed old entries return on re-enable. |
| 10 | Change A's account/display name; send to A's original issued address | Original token/address stays bound and continues delivering to A. |
| 11 | Check phone, 768px and desktop; light/dark/eink and keyboard | The full plus address, copy control, sources and body remain usable without overflow. |

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

The smoke harness creates disposable PostgreSQL/logs databases, applies historical migrations and runs actual local Edge/Core with D1/R2, then cleans up only its resources. It verifies full prefixed rendering, mixed-case envelope handling, malformed/foreign rejection before receipts, two-user isolation, deduplication, sanitized body reads and existing auth/bookmark flows. The registry continues storing account tokens; no format migration or extra configuration variable is introduced.

If the isolated Corepack home cannot download the pinned package manager, prepare its public distribution archive:

```sh
corepack pack pnpm@11.25.0 -o /tmp/slax-newsletter-pnpm.tgz
pnpm api -- test:http --corepack-archive /tmp/slax-newsletter-pnpm.tgz
NEWSLETTER_SMOKE_DOMAIN=newsletterreader.slax.com pnpm api -- test:http --corepack-archive /tmp/slax-newsletter-pnpm.tgz
```

When constructing local injection URLs manually, encode `+` as `%2B` in query parameters (or use URLSearchParams/encodeURIComponent); an unescaped plus is interpreted as a space. Do not URL-decode `message.to` again inside the Worker. Local injection bypasses Cloudflare routing, so it does not prove base-rule matching, DNS, Subaddressing, real SMTP or external platform acceptance. See [validation.md](../../openspec/changes/support-newsletter-feed/validation.md) for evidence and gaps.

## Rollback and future production

To stop, disable/restore the pilot's **literal feed@newsletterreader.slax.dev route** and disable `NEWSLETTER_ENABLED` through the maintained config/release path. Preserve existing Catch-all/unrelated literal rules. Do not globally disable Subaddressing if another route relies on it. Keep schema, completed content and all permanent reservations; disabling routing does not buffer mail for later replay.

Production stays off until every serving release and sync rule sharing PostgreSQL has RSS-kind isolation. Its later operator rollout uses newsletterreader.slax.com receiving DNS, Subaddressing and **feed@newsletterreader.slax.com** to the verified production Edge Worker. Keep root slax.com Feishu MX and daguang@slax.app forwarding intact. Only operate the selected subdomain; do not repoint the old broken slax.app Catch-all as part of this plan.

Before widening the pilot, finish hosted PowerSync cross-user/kind acceptance, real Newsletter confirmation/content tests and SMTP infrastructure-failure behavior. Subscribed bodies are not pruned by RSS's 30-day rule. Attachments, automatic unsubscribe and Newsletter saving to Inbox remain out of scope.
