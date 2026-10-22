# Newsletter dev pilot and acceptance

OpenSpec: `support-newsletter-feed`.

## Scope and readiness

The first pilot receives `<account>@slax.dev` through the existing Edge Worker **reader-backend**, whose custom domain is **reader-api.slax.dev**. Keep the active **Catch-all / Drop** rule. Production Newsletter routing is a separate decision; do not alter the Feishu MX records on slax.com.

Before enabling mail delivery, the release operator must:

1. Verify that the deployment is the isolated dev installation and that Edge and Core use the same dev PostgreSQL and R2 bucket, with the corresponding dev PowerSync instance. Do not expose credential values.
2. Apply additive migration `20261022090000_newsletter_feed` through the established dev deployment pipeline. The migration adds a default RSS kind and new address/receipt tables; it does not reset RSS subscriptions.
3. Deploy the API with the generated Feed/address controllers, email-capable Edge entry and Newsletter recovery cron. Deploy the Web version from the same task. Preserve actual Worker names and service bindings.
4. Publish the updated PowerSync rules from `deploy/local/powersync-local/sync_rules.yaml` to the dev PowerSync service through its normal operator workflow. The local file is not automatically published to a hosted service by the API release. Confirm `rss_v1` and `newsletter_v1` use disjoint source IDs. Existing RSS clients keep their previous projection columns.
5. Set ordinary configuration variables `NEWSLETTER_ENABLED="true"` and `NEWSLETTER_DOMAIN="slax.dev"` on the dev Worker configuration used for Edge and Core. Keep them disabled or absent in other installations. Maintain them in the private dev configuration repository used by CI; a dashboard-only value can be overridden by later deployments. No receiving secret and no `send_email` binding are required.
6. Confirm the existing Edge scheduled trigger includes `*/5 * * * *`; reuse it rather than adding duplicates. Recovery runs at most five pending receipts per tick, so monitor backlog age during the one-to-two-user pilot.

Use the existing pipeline described in [DEV-AND-CI-EN.md](DEV-AND-CI-EN.md). Its remote stages include `pnpm api -- migration:deploy:pgsql` and `pnpm api -- deploy`, with the operator's reviewed private configuration. Do not run these commands against a guessed installation or the public template.

## Additive API contract

All operations require an authenticated active owner and use the existing JSON envelope. Feed reads enforce each kind's enabled Lab and return private no-store responses. DTO definitions live in `packages/contracts/src/feed.ts`; older `/v1/rss/*` contracts are unchanged.

| Operation | Behavior |
| --- | --- |
| GET /v1/user/newsletter_address | Pure read: address/domain plus ready, account_required, invalid_account, unavailable or not_provisioned status. |
| POST /v1/user/newsletter_address | Idempotent first provisioning; structured error includes address_reserved, account_required, invalid_account, lab_disabled or unavailable. |
| GET /v1/feed/subscriptions | Enabled owned RSS and Newsletter sources, with required kind. |
| GET /v1/feed/entries | Combined timeline; existing subscription_id, limit, cursor, before and explicit fetch_history query semantics, with RSS-only network history. |
| GET /v1/feed/entries/:id | Authorized sanitized body plus kind and content_truncated. |

Legacy account setting retains its existing error names; Web maps EXISTS_USER_NAME_ERROR to an actionable name-conflict message and ERROR_PARAM to invalid-account guidance.

## Cloudflare console steps for the pilot operator

Only perform these steps after the readiness checks above pass.

1. In dev Web, enable Newsletter in Labs. Open Feed and generate the receiving address. If needed, create an available ASCII account in the form. Copy the exact resulting address.
2. Open **slax.dev → Email Service → Email Routing → Routing Rules**. Add an **exact custom address rule** for that copied address. Select **Send to a Worker → reader-backend** and enable the rule.
3. Repeat for a second test account if desired. Verify **Catch-all / Drop / Active** is still present. Do not switch Catch-all to the Worker during this pilot, and do not create a subdomain or change MX records.
4. In **Workers & Pages → reader-backend**, confirm the deployed version contains the email handler and `reader-api.slax.dev` remains attached. Use Email Routing activity and Workers observability to correlate receipt outcomes; do not add body/address/tracking-URL logging.

Cloudflare [email handler documentation](https://developers.cloudflare.com/email-service/api/route-emails/email-handler/) describes receiving separately from HTTP fetch. Ordinary [routing subdomains](https://developers.cloudflare.com/email-service/configuration/subdomains/) cannot use a catch-all, so do not apply an apex catch-all recipe to the future production subdomain.

## Human acceptance sequence

| Step | Action | Expected result |
| --- | --- | --- |
| 1 | Open Feed with both Labs switches off | Feed remains in navigation and shows setup guidance; no disabled content appears. |
| 2 | Enable Newsletter and provision/copy an address | Address uses the validated lowercase account and is stable on repeated provisioning. |
| 3 | Send an ordinary email from a mailbox you control to the exact routed address | One sender source and one readable Newsletter entry appear; Inbox is unchanged. |
| 4 | Send HTML and plain-text messages; include a normal link and an attachment | Safe body text is readable; HTML executes no scripts; attachments are omitted. |
| 5 | Open an email with a remote image | Image uses the signed image proxy; no direct source-image request is made by the browser. The source may observe the proxy's first cache fetch. |
| 6 | Enable RSS and add a known working RSS source | RSS and Newsletter mix in Feed; RSS refresh/rename/delete/save still work. Newsletter offers no RSS write actions. |
| 7 | Use a second account, including mail from the same sender | Each account sees only its own Newsletter messages and receiving address. |
| 8 | Change the original account name/display name, then send to the original address | Issued receiving address does not change and still reaches the original owner. |
| 9 | Disable only Newsletter, send again, then re-enable | Newsletter is hidden while disabled; RSS remains available. Delivery while disabled is rejected. Old pending work cancelled by disable does not resume after re-enable. Existing completed entries return. |
| 10 | Disable only RSS, reload, then re-enable | Newsletter remains available; RSS cache is hidden while off; enabling restores RSS behavior. |
| 11 | Inspect light/dark/eink, narrow phone width, 768px and desktop; navigate by keyboard | Address wraps, source buttons have meaningful names, reader and controls remain usable. |

An ordinary manual forward normally creates a new Message-ID and should create a new entry. To test duplicate suppression, replay identical raw mail with the same Message-ID using the local automated exercise or a controlled SMTP fixture. Do not expect two newly composed messages to deduplicate.

To test application rejection of an unknown address on dev, temporarily create an exact unbound address rule pointing to the Worker and send to it. Without that rule, unknown recipients hit the existing Catch-all Drop and never reach the application. Remove the temporary test rule afterwards. A message over 5 MiB raw size must be rejected; MIME/base64 overhead counts toward this limit.

## Engineering verification

From the repository root with your normal Web development configuration loaded. Fresh worktrees need explicit non-secret Web values; the validation record lists the public fixture values used for this change.

```sh
pnpm api -- test
pnpm api -- typecheck
SLAX_API_CONFIG=deploy/cloudflare/api.toml.example pnpm api -- build edge
pnpm api -- test:http
pnpm web -- test --maxWorkers=2
pnpm web -- typecheck
pnpm exec openspec validate --all --strict
```

The HTTP smoke uses disposable local PostgreSQL containers, actual local Workers and local R2. It exercises email dispatch, generated controller registration, durable receipt publication, repeat Message-ID, Core body reads and feature revocation, plus existing authenticated bookmark smoke flows. It does not send real SMTP. If the isolated Corepack home cannot download its pinned package manager, prepare a public cache archive first and pass it explicitly:

```sh
corepack pack pnpm@11.25.0 -o /tmp/slax-pnpm.tgz
pnpm api -- test:http --corepack-archive /tmp/slax-pnpm.tgz
```

Database/unit tests additionally cover body-write failure recovery, raw-write failure before acceptance, duplicate quotas, source/day limits, address reservation/retirement, sanitization and feature-disable races. Production SMTP behavior on an infrastructure exception before durable admission remains a separate dev acceptance check: inspect the sender's eventual bounce and Cloudflare delivery status with a dedicated test installation. Do not disrupt the shared dev API database or bindings to induce failures.

The browser review sandbox uses deterministic local fixture API responses and REST fallback. It validates real Web presentation and interaction, not Cloudflare mail delivery or live PowerSync synchronization. See the change's [validation record](../../openspec/changes/support-newsletter-feed/validation.md) for exact evidence and remaining gaps.

## Rollback and follow-up

Disable/delete only the pilot's exact routing rules or set `NEWSLETTER_ENABLED="false"` on the dev configuration. Preserve Catch-all Drop. Do not drop the new schema or release address reservations. Turning deployment admission off pauses recovery and new provisioning; completed Feed content remains readable under its per-user Lab gate.

Before broader activation: validate real SMTP outcome on pre-admission failure, measure pending-receipt age, complete live PowerSync isolation checks and define long-term retention/source management. Dev keeps Newsletter entries indefinitely while subscribed and enforces 200 sources/user, 200 admitted messages/user/UTC day and 5 MiB/message. Attachments, automatic unsubscribe and Newsletter saving to Inbox remain out of scope.

Beta and main share PostgreSQL. Both serving releases and their PowerSync rules must filter RSS kind before any Newsletter admission there; a dev-only domain is not a substitute for this compatibility rollout.
