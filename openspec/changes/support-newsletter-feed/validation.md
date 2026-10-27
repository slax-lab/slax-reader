> Current routing decision: feed+account@newsletterreader.slax.dev for dev and feed+account@newsletterreader.slax.com for production, confirmed on 2026-10-27. Earlier records below are historical; the latest subaddress revision and operator guide supersede their routing instructions.

# Validation

## Original implementation (2026-10-22)

### Environment and scope

Branch `feat/support-newsletter-feed`, based on `origin/dev` `4fa9ff08`, in a new Codex-managed worktree. At the original validation date, no remote deployment, DNS, Email Routing, private configuration edit or remote database mutation had been performed. Synthetic local resources were created and removed by the HTTP smoke harness. A subsequent user-requested local integration environment applied the additive Newsletter migration to the existing local development PostgreSQL database and initialized worktree-local D1/R2 state. Existing operator configuration is loaded through normal application startup; secret file contents were not printed or copied by the agent.

## Automated checks

- `pnpm install --frozen-lockfile`: passed (Node 24.15.0, pnpm 11.25.0). postal-mime 4.1.3 subsequently pinned with its lockfile and a documented release-age exception; it has no lifecycle installation hooks or runtime dependencies.
- `pnpm api -- gen:all` with the public example configuration and generation-only PostgreSQL placeholders: passed. Generated model/router/DI/cron and Worker runtime types are included.
- `pnpm api -- test`: **2352 passed, 71 skipped**, 181 files passed / 12 skipped (final run 2026-10-22 16:18 Asia/Shanghai). Skips are the existing opt-in PostgreSQL suites and sample fixture tests; the changed repositories were exercised separately with embedded PostgreSQL and actual local PostgreSQL below.
- `pnpm api -- typecheck`: passed; contracts and API TypeScript checked.
- `SLAX_API_CONFIG=deploy/cloudflare/api.toml.example pnpm api -- build edge`: passed. It is an offline dry run and performs no publication.
- Scoped API ESLint: **0 errors**, 14 warnings including existing any/unused declarations and required route request parameters. No new lint error remains.
- Clean sequential full Web suite with explicit public fixture environment (PUBLIC_BASE_URL/AUTH_BASE_URL/SHARE_BASE_URL=https://reader.example.test, COOKIE_DOMAIN=localhost, COOKIE_TOKEN_NAME=slax-review-token, DWEB_API_BASE_URL=http://localhost:3058, GOOGLE_OAUTH_CLIENT_ID=local-fixture, SLAX_API_CONFIG=deploy/cloudflare/api.toml.example): **2518 passed, 3 skipped**, 220 files passed / 1 skipped, on 2026-10-22 16:28 Asia/Shanghai. This includes the legacy account-setting error regressions. A non-fatal happy-dom fetch AbortError was printed during teardown; no Vitest failure/unhandled-error summary or pnpm failure occurred.
- Earlier Web attempts are superseded: two temporary template parse failures during a concurrent edit; Nuxt build/test cache interference from running build concurrently; and two existing locale fallback tests without required cookie configuration. The final run used sequential preparation and explicit non-secret configuration and passed all tests.
- Web production build with public placeholder configuration: passed. Web typecheck after production build/prepare: passed.
- `openspec validate --all --strict`: **73 passed, 0 failed**. Existing informational archive notices elsewhere in the repository remain unchanged.
- `git diff --check`: passed.

## Running API exercise

`pnpm api -- test:http --corepack-archive /tmp/slax-newsletter-pnpm.tgz`: **passed**, 2026-10-22 16:19 Asia/Shanghai. The archive is a public pinned pnpm distribution prepared by `corepack pack`; no private cache or credentials are inherited. The harness runs actual Edge/Core entrypoints through local Wrangler, full historical PostgreSQL/logs/D1 migrations, real Prisma/pg transactions and local R2.

Exercised:

- Authenticated account setting and independent Newsletter Lab enable through actual generated HTTP routes.
- Address provisioning `newsletter-smoke@slax.dev` through Core, followed by two raw RFC5322 deliveries to the actual Edge email handler.
- Envelope recipient controls ownership even when header To names another address; duplicate Message-ID yields exactly one durable receipt and one entry.
- Core Feed subscriptions/list/body expose the Newsletter kind and read the body object written by Edge; script/CID content is absent.
- Newsletter disable hides entries and denies body reads; unknown routed recipient creates no receipt.
- Existing HTTP authentication, CORS, bookmark sharing/save/delete, D1/fulltext and PostgreSQL smoke flows still pass.

The first real run exposed Prisma's unsupported void-column decoding for advisory locks, which embedded PostgreSQL did not reproduce. Changed the new locks to execute-only SQL and verified account-setting and provisioning in the successful run. Local startup also needed the official tsx loader API to avoid macOS Unix-socket length limits in this long worktree; this changes only the smoke launcher.

Additional database/service tests exercise immutable duplicates, quotas including pending receipts, quota preflight before R2 writes, raw-write failure before admission, body-write failure after admission and later recovery, raw GC preserving pending obligations, retirement on deletion, disable/enable fencing, stable address after rename and reservation conflicts. RSS tests cover legacy endpoint/write/poll/history/quota/retention kind isolation and preservation of truncated-body metadata. Feed tests additionally exercise actual loopback HTTP with embedded PostgreSQL, cross-user denial and cursor/source/type scope.

## Running Web exercise

Actual Nuxt Web components and routes were exercised in a browser at local ports 3057/3058 against deterministic fixture API responses. A temporary layer outside the repository replaces the PowerSync plugin with the supported REST fallback. It does not validate live PowerSync or SMTP.

Browser matrix passed at **1440, 768 and 390px**, in **light, dark and eink**. For every width/theme: mixed Feed, source switching and Newsletter preview were exercised; body overflow was absent, keyboard focus remained visible, and reduced-motion preference was set. E-ink backdrop blur is disabled and Newsletter previews have no empty action footer. The matrix also exercised address provisioning/copy, missing account form, reserved-name recovery, unavailable receiving, both-off onboarding/Labs navigation and independent feature toggles. Final browser results had **zero page errors**.

Findings repaired and covered: exact-768px shell/sidebar breakpoint mismatch, duplicate avatar text in source accessible names, Newsletter-only empty copy, second sanitizer losing truncation, unsafe relative srcset resolution, and stale processing across disable/re-enable. Screenshots are temporary local artifacts, not committed to Git.

## Full local integration environment

On 2026-10-22, started the feature worktree's actual API Workers (Edge 8787, Core 8686, AI 8788 and Browser 8789) and Web on port 3000. The local-only Newsletter configuration uses `NEWSLETTER_ENABLED=true` and `NEWSLETTER_DOMAIN=newsletterreader.slax.com`; this matches addresses locally without creating DNS or mail-routing records. Existing operator configuration remains unchanged. Cloud-only AI/browser-rendering/vector/analytics integrations are excluded from this local pilot.

- `pnpm api -- migration:deploy:pgsql` with an explicit loopback development database applied `20261022090000_newsletter_feed`; local D1 and fulltext migration commands completed with no pending migrations.
- A separate `newsletter-local-powersync` container on loopback port 18082 loads this branch's sync rules, uses its own local `newsletter_local_sync` storage database and the existing local source database. Its readiness endpoint returned HTTP 200; logs confirmed snapshot completion and activation of the PostgreSQL replication stream. Existing PowerSync containers were preserved.
- `/ping` returned HTTP 200, unauthenticated Newsletter-address access returned the expected authorization error, and Web `/login` and `/bookmarks` returned HTTP 200. Browser inspection confirmed the rendered login controls.
- A raw message injected through `/cdn-cgi/local/email` to an unbound local address returned HTTP 400 with the generic application rejection. A temporary local helper was provided for HTML, plain-text and duplicate Message-ID deliveries to the address copied from Web.
- These startup and readiness checks do not independently establish every authenticated PowerSync stream or cross-user isolation scenario. The human's subsequent integration acceptance is recorded below; specific per-case results were not supplied.

## Human hands-on acceptance

**yjc**, 2026-10-22, in this task before any PR: opened `http://localhost:3058/__sandbox/bootstrap`, exercised Feed switching, Newsletter body and address copying, and replied **“已操作，界面可以接受”**. No human-requested adjustment remained. Agent-discovered responsive/accessibility/empty-footer polish was then verified by the browser matrix. The review sandbox contains fixture data only.

**Additional integration acceptance:** yjc, 2026-10-22, after the full local API/Web environment above was prepared, reported that testing matched expectations and authorized proceeding with the PR. No additional adjustment was requested. This supplements the earlier pre-PR UI acceptance; it does not claim external SMTP delivery or enumerate unreported test cases.

## Review and release assessment

Bugs, Security and Compliance passes resolve to OpenSpec `support-newsletter-feed`. Independent review found no remaining Important code issue; its pending evidence finding is addressed by this record. No CLI, Extension or Mobile shipped behavior, dependency graph, contracts consumed by them or package output changes: the new contracts are additive and legacy RSS interfaces/projections are unchanged, so no application version increment is required. Root manifest/lock changes may still select those applications for CI checks.

## Gaps and operator work

- **Not deployed to slax.dev.** Matching real Edge/Core PostgreSQL/R2 bindings, private CI configuration, live hosted PowerSync rule publication and Cloudflare root-domain Catch-all activation require the dev release/operator sequence. The exact-address pilot has been superseded by the approved 2026-10-27 revision.
- **No real external SMTP test.** Local email dispatch and application rejection are verified; sender bounce/delivery status and Cloudflare's behavior on an infrastructure failure before durable admission require a dedicated dev test. Post-admission publication recovery is covered locally.
- **No hosted PowerSync acceptance.** The separate local server replicated successfully and the user accepted local integration testing, but hosted rule publication and explicit cross-user/kind isolation with real synchronization remain dev rollout checks before expanding the pilot.
- Newsletter source management/automatic unsubscribe/Inbox save/attachments are deliberately absent. Subscribed mail has no 30-day expiration; monitor storage and pending-receipt age. The retry batch is capped at five per five-minute tick.

Operator steps and human test cases: [Newsletter dev pilot](../../../docs/api/NEWSLETTER-DEV-PILOT.md). Beta/main admission stays off until all shared-database readers and sync rules have RSS kind isolation.


## Historical root-domain revision (2026-10-27, superseded before deployment)

### Scope and configuration

The user approved dev `<account>@slax.dev`, production `<account>@slax.app`, and preservation of the existing production business mailbox. The feature branch was synchronized with `origin/dev` (`79491af2` at the start of the update); conflict resolution retained the upstream fork smoke harness, generator controller inventory and API development documentation. No UI template, style or translation changed in this revision, so the pre-PR human acceptance above still covers the unchanged presentation.

Application policy rejects `daguang@slax.app` case-insensitively on address GET/POST and recipient lookup, including stale bindings. It leaves `daguang@slax.dev` eligible and preserves a different issued address after a later rename to daguang. Registry ownership is neither deleted nor reassigned. The existing `address_reserved` contract/UI is reused; no new runtime variable, migration or public DTO is introduced by this revision.

Private configuration PR #7 changes only `NEWSLETTER_ENABLED`/`NEWSLETTER_DOMAIN` plus README guidance: dev is true/slax.dev; beta, prod and the legacy main copy are false/slax.app. All four TOMLs parse; a selected-key comparison and exact-byte comparison after removing only those two key lines confirm that all unrelated configuration remains unchanged. No sensitive file was printed or copied. Configuration is prepared for review, not deployed. Main application deployment consumes api/prod.toml.

### Automated and running-environment evidence

- Regression-first check: baseline Newsletter tests **21 passed**; the three added reservation tests failed for the missing policy before implementation, then parser/repository suites passed **24 tests** after implementation.
- `pnpm api -- gen:all` with the public example config and explicit loopback generation-only database placeholders: passed. Generated outputs were produced through the generator.
- Full API suite: **2550 passed, 112 skipped**, 195 files passed / 13 skipped. Existing opt-in/fixture skips remain; changed repository scenarios also run with embedded PostgreSQL and real PostgreSQL in the Worker smoke.
- API/contracts typecheck: passed. Web typecheck with the public fixture environment documented above: passed; the missing local Turnstile site-key warning is non-fatal.
- Full Web suite, sequential preparation with public fixture environment and `--maxWorkers=2`: **2559 passed, 3 skipped**, 225 files passed / 1 skipped. Existing fixture stderr includes `getaddrinfo ENOTFOUND api.test`; the process exited successfully without a failed-test/unhandled-error summary.
- Edge build with `SLAX_API_CONFIG=deploy/cloudflare/api.toml.example`: passed as an offline dry run; no publication occurred. Scoped changed production API ESLint: passed with no output.
- Strict OpenSpec validation: **78 passed, 0 failed**. Existing informational notices remain.
- Production-domain HTTP smoke with `NEWSLETTER_SMOKE_DOMAIN=slax.app` and the same public Corepack archive: passed. Actual Worker GET/POST return code 409/address_reserved, a seeded stale binding remains blocked, and a mixed-case envelope reaches the application handler and receives its generic policy rejection with zero receipts. Normal slax.app delivery/deduplication/body reads and existing bookmark smoke flows also pass. This is entirely local and does not enable production.
- Default HTTP smoke with `--corepack-archive /tmp/slax-newsletter-pnpm.tgz`: passed. Actual local Edge/Core, historical PostgreSQL/logs/D1 migrations, Prisma transactions and local R2 proved that daguang@slax.dev can be issued, normal delivery deduplicates to one receipt/entry, Core reads the body, disabled/unknown recipients are rejected and existing bookmark/auth/CORS flows still work.

The smoke launcher now passes guarded `localDevOptions` into the installed Wrangler CLI directly. The former nested launcher created another empty Corepack home, bypassing the pre-seeded public pnpm cache and failing before Worker startup. The direct invocation retains local-only configuration validation, an isolated environment, short IPC paths and owned-resource cleanup. An initial production-domain fixture lacked Message-ID, so Miniflare rejected it before application dispatch; the fixture was corrected to ensure the test reaches the handler. These startup/fixture failures are not claimed as application acceptance.

### Local pre-push review

Bugs: checked full-domain/case handling, GET purity, POST idempotence, stale registry refusal, no R2/receipt/entry writes on policy rejection, stable issued addresses after rename, and retention of upstream smoke behavior during synchronization. Security: no new dependency, external service call, operator credential, private configuration copy or email-data logging is introduced by this revision; SQL remains parameterized and the reservation is enforced before MIME reading/storage. Compliance: implementation and configuration match `support-newsletter-feed`, the user's approved dev-first scope and the unchanged UI acceptance; operational work remains explicitly deferred. No Important finding remains from these three passes.

No new authored CLI, Extension or Mobile runtime/package behavior or consumed contract change results from this revision. Upstream changes synchronized from dev keep their original release/version decisions; no additional application version increment is needed here.

### Remaining operator acceptance

No hosted deployment, DNS/Email Routing mutation, production enablement, hosted PowerSync publication or real SMTP send was performed during this update. Start with dev only. After config/app deployment and sync readiness, the operator changes **slax.dev Catch-all: Drop -> Send to a Worker -> reader-backend**, preserving literal routes. The production Catch-all is not changed; the active daguang forwarding rule remains untouched. External delivery/confirmation, sender failure behavior and hosted cross-user sync isolation require the dev acceptance sequence. The local production-domain simulation does not prove hosted production routing or business forwarding.

Current guide: [Newsletter dev pilot](../../../docs/api/NEWSLETTER-DEV-PILOT.md). The root-domain guide supersedes historical exact-address instructions above; completed content and permanent reservations remain intact.


## Selected feed+ subaddress revision (2026-10-27)

### Requirements and implementation

The user explicitly selected fixed prefix feed and restored newsletterreader.slax.dev / newsletterreader.slax.com. Dev remains enabled in reviewed private configuration; beta/prod and the legacy main copy remain explicitly disabled. No hosted deployment or mail-routing mutation was made. This revision supersedes the root-domain plan rather than activating it.

Provisioning/rendering adds feed+ to the stable canonical account token stored in local_part. The token is scoped by domain, never recomputed after account rename, and never released on retirement. Eligibility is at most 59 ASCII characters so the full local part fits SMTP's 64-octet bound. Global account rules stay unchanged. Invalid long accounts are not truncated; oversized legacy stored tokens remain reserved and fail explicitly rather than exposing an invalid mailbox. No new schema, public DTO or environment variable is introduced.

Incoming mail requires the complete configured domain, feed+ and one valid non-empty account token. Bare feed, missing/wrong prefixes, extra plus details, whitespace, unknown and foreign-domain recipients are rejected before raw storage. The envelope is not URL-decoded again; local query builders encode plus as %2B. The previous root-address daguang reservation is removed because feed+daguang@newsletterreader.slax.com does not claim daguang@slax.app. Existing root mail services/forwarding and Catch-all rules remain untouched.

### Verification

- Regression-first Newsletter run: **11 expected failures / 15 passes** after changing address expectations and adding length/envelope scenarios, before implementing the format. After implementation: **26 passed** (parser 7 / repository-service 19). The failures demonstrated missing prefix rendering, old length eligibility and missing strict envelope parsing rather than fixture startup errors.
- Full API suite: **2552 passed / 112 skipped**, 195 files passed / 13 skipped. Existing opt-in and fixture skips remain. Embedded PostgreSQL exercises stable bindings, 59/60-character boundaries, legacy long-token reservation, mixed-case dispatch and no storage on invalid envelopes.
- Full Web suite with the public fixture environment above and --maxWorkers=2: **2559 passed / 3 skipped**, 225 files passed / 1 skipped. Existing fixture stderr includes ENOTFOUND api.test; exit status is zero. After normalizing the remaining copy/privacy fixtures to the final plus address, the address component suite separately passed **7 tests**, including literal plus-address copy behavior.
- API/contracts and Web typechecks passed. No site key is provided in the local Web fixture; its Turnstile warning remains non-fatal.
- pnpm api -- gen:all passed with public example configuration and loopback generation-only PostgreSQL/log placeholders. Generator outputs were unchanged; none were hand-edited.
- Edge offline dry-run build passed; changed production API ESLint passed with no output. Strict OpenSpec validation: **78 passed / 0 failed**. git diff --check passed.
- Default actual local HTTP smoke with the public Corepack archive: **passed** for newsletterreader.slax.dev. It provisions feed+ addresses for two users (including daguang), rejects nine invalid/bare/foreign envelopes with zero receipts, accepts mixed-case plus recipients, deduplicates the first delivery to one entry, publishes a separate second user's body, denies that user the first user's body, and preserves existing bookmark/auth/CORS/D1 smoke flows. Actual Edge/Core, full historical migrations, Prisma/PostgreSQL and local R2 run; only owned synthetic resources are created and cleaned up.
- Production-domain actual local HTTP smoke with NEWSLETTER_SMOKE_DOMAIN=newsletterreader.slax.com and the same public Corepack archive: **passed**, including both prefixed users, malformed/foreign rejection, duplicate suppression and cross-user body denial. No hosted production resource was activated.

### Review and acceptance scope

No Vue presentation, styles, labels, navigation or client API DTO changed. The original 2026-10-22 human acceptance remains recorded above for the unchanged setup/copy/reader UI; updated component fixtures verify the complete plus address is displayed/copied. Long-address/responsive checks and real provider behavior are also explicit hosted dev acceptance items, not claims of new human testing in this revision.

No authored CLI/Extension/Mobile logic, dependency graph or consumed contract changes are introduced; their versions need no increment. The private TOMLs were parsed and checked against origin/main: only the two approved Newsletter keys differ, and all unrelated bytes are identical after excluding those key lines. README and both operator guides explain the selected format and rollback.

### Independent and local pre-push review

The requesting-code-review reviewer independently inspected all 16 revised app/docs/spec/test files against 8f1375d4 in read-only mode and reported **no Important findings and no Nits** across Bugs, Security and Compliance. The parent also checked the private configuration's selected values and exact unrelated bytes. Review confirmed canonical token/rename preservation, the 59-character limit, strict envelope gating before MIME/R2, parameterized SQL, no new external calls/dependencies/PII logs, matching OpenSpec intent and scoped literal-route rollback. Production simulation was still running during the independent review and subsequently passed as recorded above. No excluded behavior was silently dropped: hosted routing, platform acceptance and sync isolation remain explicit operator work; unchanged visual presentation retains its earlier acceptance.

### Operator acceptance still required

No Cloudflare DNS/base-route/Subaddressing matching, real SMTP, hosted PowerSync publication/isolation or real Newsletter subscription was exercised locally. After deployment readiness, add the receiving newsletterreader subdomain in slax.dev, enable Subaddressing, and add only feed@newsletterreader.slax.dev -> reader-backend. Preserve existing Catch-all and literal/plus-detail rules. Test two actual plus recipients, bare/unknown detail rejection, real confirmation/content delivery and sender failure status. Later production setup must preserve root slax.com Feishu MX and slax.app business forwarding. Scope rollback to the pilot's literal route/admission; do not disable zone-wide Subaddressing if other routes depend on it.

See [current dev operator guide](../../../docs/api/NEWSLETTER-DEV-PILOT.md). Local injection bypasses Cloudflare routing and does not establish external platform compatibility; the guide explicitly requires representative real Newsletter tests.
