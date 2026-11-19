# Validation

Date: 2026-11-18. Branch: `fix/store-newsletter-binding-name`, isolated worktree `newsletter-binding-name/slax-reader-v2`.

## Scope and behavior
- Newsletter bindings store only the confirmed receiving name in both platform_id and user_name.
- Complete addresses use the bound name and current configured domain, preserving explicit full-address confirmation. Reader renames do not rewrite the binding.
- Reservation and advisory locking use the name; SMTP domain/prefix validation remains in the receiving service before repository lookup.
- No schema/migration, old-format reads, automatic conversion, configuration-repository, RSS, R2, PowerSync, or Mobile changes.

## Automated evidence
- New assertions failed against the original implementation: bare-name persistence, cross-domain reservations and delivery after a domain change. The implementation then passed the focused tests.
- `pnpm install --frozen-lockfile`: passed; lockfile unchanged.
- `pnpm api -- gen:all` with the public template and generation-only placeholder database URLs: passed, no tracked generated drift. The first attempt lacked required generation URLs; supplying placeholders resolved it without reading secret files.
- `pnpm api -- test`: 271 files / 4319 tests passed; 20 files / 159 optional tests skipped.
- Final focused Newsletter and layer-architecture run: 8 files / 136 tests passed.
- Native PostgreSQL tests on a dedicated disposable PostgreSQL 17 container: 6 passed, including two owners concurrently reserving one name under different domains. Only historical migrations were applied to this disposable database; the container was removed afterwards.
- `pnpm api -- typecheck` and `pnpm web -- typecheck`: passed.
- `pnpm api -- lint`: 0 errors, 344 existing warnings across the API; no broad lint cleanup included.
- NewsletterAddress component regression: 30 tests passed after preparing the fresh worktree with `pnpm web -- setup`. The initial attempt preceded Nuxt preparation and could not load `.nuxt/tsconfig.app.json`.
- `pnpm exec openspec validate --all --strict`: 153 items passed.
- `git diff --check`: passed.

## Running-environment evidence
- `pnpm api -- test:http`: passed using isolated local Edge/Core, PostgreSQL, D1 and R2. Real setup confirmed the complete API address while SQL asserted `platform_id:user_name = newslettersmoke:newslettersmoke`. Incoming MIME delivery/repeat, private body reads, owner isolation, independent Inbox saves and deleted-user behavior passed.
- Native PostgreSQL covered concurrent cross-domain name reservation and deleted-owner reservation; PGlite/service tests covered a configured-domain change without a binding update, rejection of the old domain/renamed account/root business domain, and delivery to the original bound name under the new domain.
- User integration: API Workers listen on 8787/8686/8788/8789; PowerSync local services are healthy on 18080/18081; Web initially ran on http://localhost:3008/. On user request, the unrelated development listener on port 3000 was stopped and this task's Web service was moved to http://localhost:3000/ with matching public/auth/share origins. API and the dedicated acceptance databases were preserved. Browser inspection confirmed the Login page rendered. The user subsequently completed local testing and accepted the implementation.
- Local app loaders use symlinks to existing operator secret-file paths without copying or printing their contents. Startup inspection found an obsolete Newsletter migration in the existing local database and no configured Newsletter domain. Rather than repairing/resetting that database, local acceptance uses freshly created newsletter_binding_dev, newsletter_binding_logs and newsletter_binding_sync databases with current historical migrations. An ignored, generator-consumed local API configuration points Hyperdrive at these databases and sets newslettereader.slax.dev. Dedicated PowerSync containers use the same current sync rules and these new databases. Existing user rows were not converted, deleted or reset. The PowerSync API container was restarted after a cold-start namespace-creation race; this is a local startup operation, not application retry logic.

## Reviews
- Author reviewed Bugs, Security and Compliance against `store-newsletter-binding-name`: no important findings; existing naming and service-to-repository responsibility remain intact.
- Fresh-context `binding_name_review` subagent: no Important findings or Nits; no files edited.
- Claude boundary review invoked through the installed CLI with `--model claude-opus-5-5`, tools disabled, safe mode, and only the diff plus non-secret code/spec context. No Important findings. The provider reported requested model `claude-opus-5-5` with canonicalModel `claude-opus-5`; this is not independent proof of a distinct 5.5 backend.
- Claude coverage Nit: add explicit root-domain rejection; added to the service test (the existing actual HTTP smoke also exercises daguang business-mail separation).
- Claude copy Nit: clarify which part is fixed; confirmation now identifies the receiving name as the part after `feed+`, and the badge refers to a fixed name.
- Removed an unrelated formatting-only hunk produced by Prettier in the HTTP fixture.

## Gaps and rollout
- The broader Web suite did not complete: several Nuxt environment setup hooks timed out (useRssLocal, DwebArticleSelection, chatbot, BookmarkTags, TagsHeader, BookmarkCell, ChatBot, SnapshotChatPanel), with an `api.test:443` TLS ECONNRESET in setup. A reduced-worker attempt encountered the same network setup failure. Both broad attempts were stopped; no unrelated test infrastructure was changed. The focused component suite and Web typecheck passed. Dev was restarted after verification to avoid concurrent Nuxt preparation removing its generated dist directory.
- Real Cloudflare routing and production delivery were not exercised: this change does not modify routes, domains or PowerSync rules.
- Existing-data edits are explicitly operator-owned. Coordinate beta/main API rollout and manual database edits: while old and new code serve the shared database, old code cannot interpret bare-name rows and can reserve a conflicting full-address row. This includes new bindings created during that window. No compatibility layer or conversion script is included, per user direction.
## Human acceptance
- Accepted by the requesting developer on 2026-11-18 after testing the actual local environment at http://localhost:3000/; their reported result was that local testing met expectations, with an explicit request to commit and open the new PR.
- Acceptance covered the requested setup/second-confirmation/copy, fixed receiving name after Reader account rename, and EML delivery exercise. This is the developer's reported acceptance, not an independent claim of observing each browser action.
- Requested adjustment before acceptance: move Web from 3008 to 3000 because sign-in on 3008 did not work for the user. The authorized existing port-3000 listener was stopped; Web and public/auth/share origins moved to 3000. No application code or existing test rows changed for this adjustment.
- Read-only follow-up inspection showed the ready card displaying `feed+reader01@newslettereader.slax.dev`, the fixed-name badge and revised receiving-name/domain copy in light theme. No private message content was captured.
- Local pre-push review rechecked Bugs, Security and Compliance, including the accepted scope and verification gaps: no Important findings. CLI, Extension and Mobile runtime surfaces/contracts are unchanged, so no package-version decision is needed.

## Key visuals
- One before/after group: expanded, ready Newsletter setup card; light theme, 2268px desktop viewport, full viewport. The before capture renders origin/dev locale text with the same local ready binding; the after capture renders the accepted locale text. No backend behavior or data was reverted for the comparison, and accepted locale files were restored before staging. The group shows fixed-address wording becoming fixed-name wording with Slax-managed domain guidance.
- This change alters copy only within the existing layout: no tokens, styles, responsive structure or controls changed. Browser evidence is from the light desktop state; dark/e-ink/narrow visual wrapping was not separately captured in this run.
- Pre-push rerun: focused Newsletter + architecture tests 136 passed; strict OpenSpec validation 153 passed.

## PR review gate follow-up
- The first CI run passed API, Web, Mobile, Extension, CLI, tooling and agent-config checks but failed the PR review gate on one Important Compliance finding: the delta omitted the existing persistence requirement's complete-address advisory-lock sentence.
- Added MODIFIED deltas for Independent first-release persistence (name-based lock and cross-domain concurrency scenario) and Confirmed collapsible Newsletter setup (fixed receiving name, current-domain wording). Clarified the proposal's preserved owner-row lock versus changed advisory-lock key.
- Runtime implementation, API contracts, dependencies and schema are unchanged by this documentation-only correction. Existing focused/native tests already cover the documented concurrency and domain behavior; no new runtime tests are needed for this correction.
- The optional legacy-row validation Nit is deliberately not implemented: the user explicitly excluded existing-data compatibility/handling, and input is validated at first provisioning. The rollout scope remains operator-owned as documented above.
