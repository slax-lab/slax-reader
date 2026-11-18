# Validation

## Scope and authorization

Implementation base: `dev` at `1e821fc5`, isolated branch `feat/add-email-link-auth`. The change requester approved the proposal and direct implementation on 2026-11-18, and approved Mobile 1.0.33 (808), previous build 807. Native metadata was regenerated through Expo; unrelated local Firebase configuration output was restored to the baseline.

No database migration, PowerSync change, new HTTP authentication endpoint, Redis command/Lua, provider replacement, or signing-certificate trust change is included. Existing account ownership policy and session completion are reused. Only Mobile needs a package version change; CLI/Extension do not consume the new proof or link entry.

## Automated evidence

Logs are task-local under `/tmp/slax-email-link-20261118/`.

| Check | Result / evidence |
| --- | --- |
| API typecheck / shared contracts | Passed, `api-type.log`; local dependencies were synchronized with the unchanged frozen lockfile. |
| API full Vitest suite | 4,330 passed, 145 skipped across existing opt-in suites; `api-full.log`. All 18 email Redis tests ran with a disposable real Redis instance. |
| API layers and ownership orchestration | Layer architecture 35 passed; existing provider-link tests and added email-link orchestration passed. No baseline exceptions added. |
| Backend generation | `gen:all` completed using the checked-in example config and synthetic local database URLs, without reading operator credentials; generated source has no tracked drift. |
| Web full Vitest suite | 3,121 passed, 3 skipped; `web-full-final.log`. Initial missing-public-config failures were resolved by supplying non-secret fixture settings; a teardown AbortError was printed by the test DOM, without a failed test. |
| Web typecheck | Passed with non-secret public fixture settings, `web-type-configured.log`. The first unconfigured run's errors disappeared without changes to the unrelated Extension bridge page. |
| Web scoped lint | Passed for the new page, composable, URL capture, routing and startup policy. Existing unused attribution import in `useAuth.ts` remains an existing warning. |
| Mobile full check | 1,307 passed, no skips, `mobile-check-reviewed.log`; later review fixes were verified by the focused controller/mounted suites. |
| Mobile final focused checks | 66 passed: 13 controller cases including real-session hydration, 49 mounted login cases including old Google/Apple/OTP/Passkey and commit preservation, and 4 native configuration cases. See `mobile-real-session.log`, `mobile-focused-final.log`. |
| Mobile typecheck / JS export | Passed; iOS and Android Hermes bundles exported, `mobile-type-final.log`, `mobile-bundle-reviewed.log`. |
| Native configuration | Expo prebuild regenerated version 808, iOS associated domains, and exact-path Android filters. Configuration tests preserve credential associations, fixtures and certificate fingerprints. |
| OpenSpec | All 150 items passed strict validation, `openspec.json`. |

## Running environment

`DOCKER_HOST` selected the local OrbStack socket. `pnpm api -- test:http` exercised the real Core Worker, generated DI/router, PostgreSQL, Upstash client against disposable Redis, and normal account/session logic. New checks passed for a fragment-only login URL, unchanged delivery response, `/login` with `email_link`, verified `mail` binding, and code/link mutual invalidation in both directions. Existing email, Passkey and broader HTTP smoke flows passed. Resend was replaced only at the test transport boundary; no real email was sent. Evidence: `http-smoke.log` and its recorded isolated workspace.

The Web preview at `http://localhost:4296` mounts the actual landing page, composable, request client and cookie completion with the real email domain service/Redis. Resend delivery is captured locally; account/session data is synthetic. Browser testing completed successful login, current-session preservation, consumed-proof recovery, URL scrubbing before the following DOM telemetry trap, and light/dark/e-ink display at default, 768px and 320px widths. No horizontal overflow was observed at the checked widths. Screenshots are retained outside Git: `web-existing-account.jpg`, `web-dark-768.jpg`, `web-eink-320.jpg`.

The actual preview-profile Cloudflare Pages build completed. Local Wrangler Pages serving its build returned 200 for both `/email-login` and `/email-login-web`, with no redirect. AASA and Digital Asset Links returned anonymous 200 JSON under simulated preview, beta and production Host headers. Both existing credential associations and new path-scoped App Links remain present. `autoSubfolderIndex: false` produces flat HTML, so the checked canonical route remains slashless. Preview, beta and production profile builds all completed (`web-build.log`, `web-build-beta.log`, `web-build-production.log`). The production HTML places proof capture before the module entry. Android unsigned Release assembly passed (`android-build-final.log`, 1,524 Gradle tasks). This is compilation evidence, not signing or device acceptance. The first attempt lacked `ANDROID_HOME`; using the existing SDK resolved it without a source change.

## Human acceptance

On 2026-11-18, the change requester exercised the local Web preview's three mail scenarios and explicitly replied “Web 验收通过”. The implemented page displays persistent localized guidance, preserves an existing account, and offers normal sign-in recovery. The earlier optional demo was declined in favor of the reviewed proposal.

## Review closure

See [review.md](review.md). Requested Codex architecture/scope review and actual Claude Opus 5.5 edge review completed. Confirmed findings were reproduced and fixed; evidence-based false positives were withdrawn. No Important finding remains from those reviews.

## Remaining acceptance

- Signed iOS/Android cold/warm App Link routing and human App hands-on acceptance remain pending. Public association files must be published before that system-level routing can be exercised; existing Passkey-only association is insufficient. An untrusted local Android signature is not routing evidence, and no extra certificate trust was added.
- Actual Resend delivery, recipient mail-client fragment preservation, and the operator's click-tracking setting remain pending. Captured local delivery is not a live-email result.
- These are open tasks, not completed acceptance or permission to ship. No feature PR has been opened, no deployment performed, and no change archived. Any association-only support Draft PR requires the change requester's approval before creation.

## Internal-delivery follow-up and publication preflight (2026-11-18)

The requester split code-only internal delivery into Draft PR #661, then requested link logging in this feature. The feature incorporates that prerequisite locally and appends the link to its existing internal-only email/code log. Ordinary addresses and binding requests retain their delivery policy; clients do not log incoming proofs.

Fresh follow-up evidence (`/tmp/slax-email-link-20261118/internal-link-*` and `http-internal-link.log`): 80 focused API tests passed (including 18 real-Redis tests), API typecheck and scoped lint passed, and backend generation completed with no final generated drift. Three new link-log assertions failed before the added link and passed afterward. Full Core Worker HTTP smoke passed again: codes and links read from actual internal issuance logs authenticated through existing login, no provider delivery occurred for internal addresses, and replay / consumed-code attempts were rejected. Existing ordinary-mail OTP/link mutual consumption, binding and Passkey smoke assertions also passed. The fixture message-inspection GET now supplies its existing authentication header.

Support PR #660 merged; live anonymous HTTPS GETs of both `r.slax.dev/.well-known` association files returned 200 JSON matching the expected source, including App Link permission and preserved Passkey entries. This resolves the website-association publication dependency only. iPhone 12 is detected, but native preparation reports Developer Mode disabled; the requester was asked to enable it manually. No App installation or native acceptance is claimed yet. The requester provided a real-mail recipient and a logged-in QQ Mail browser; receipt of a combined real Resend email remains pending local backend configuration. No personal recipient or proof is recorded in this document.

The signed iOS Debug build completed (`ios-device-build.log`), version 1.0.33 (808). `codesign --verify --deep --strict` passed, and the signed application identifier is `8G3A932HJG.app.slax.reader` with both credential and App Link associations for all three public hosts (`ios-signed-associations.json`). This is a build/signature check only; it has not been installed or accepted on iPhone 12. It was prepared without loading operator Mobile dotenv configuration.
