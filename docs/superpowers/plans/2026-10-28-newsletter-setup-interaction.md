# Newsletter Setup Interaction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the accepted collapsible setup card and explicit permanent-address confirmation, then prepare local integration for human acceptance.

**Architecture:** Keep the existing user setting endpoints and binding table. A full-address confirmation on setting-enable distinguishes creation from plain Lab activation. The repository validates the frozen candidate under the existing owner lock. NewsletterAddress owns presentation, safe per-user disclosure persistence, dialog state and inline feedback.

**Tech Stack:** Existing TypeScript Workers, PostgreSQL, shared contracts, Nuxt/Vue, native dialog and Vitest. No new dependency.

**Spec:** `openspec/changes/support-newsletter-feed/specs/newsletter-feed/spec.md`. The requesting user approved the corrected interactive demo on 2026-10-28 and chose implementation in this worktree. After the dialog-centering correction, the requesting user accepted the local implementation on 2026-10-28 and authorized updating the original PR.

## Global Constraints

- No new table, migration, route, cron, Newsletter PowerSync or RSS change.
- Dev addresses use feed+account@newsletterreader.slax.dev; beta/production use newsletterreader.slax.com.
- Existing receiving addresses never change; a stale confirmation cannot issue a different mailbox.
- Collapsed state retains complete address/copy/fixed status; only a boolean preference is stored per user in localStorage.
- Use existing Web semantic tokens, native modal focus/keyboard behavior, 44px controls, and symmetric 10px disclosure padding. Support Chinese/English, light/dark/e-ink, desktop/768px/narrow widths and reduced motion.
- Ordinary Labs enablement performs no address creation. Confirmed creation reuses setting-enable with newsletter_address; no extra availability API is needed.

## Review Focus

- Another tab changes the account/domain between preview and confirmation: repository rejects the unmatched full candidate.
- User/session changes while a modal or request is active: no stale write is started and no stale response/draft/address reaches the new user.
- Storage is blocked or contains corrupt preference data: setup and copy still work; another user does not inherit the preference.
- Business conflicts arrive in real RequestError envelope shapes: show localized inline feedback and keep the draft.
- Escape/cancel/repeated activation and pending requests: cancellation starts no writes, pending confirmation cannot double-submit, focus returns appropriately.

## Task 1: Explicit creation contract

**Files:** `packages/contracts/src/feed.ts`, API `src/handler/http/userController.ts`, `src/domain/newsletter.ts`, `src/infra/repository/dbNewsletter.ts`; tests `test/handler/http/userLabs.test.ts`, `test/domain/newsletter/repository.test.ts` and `test/runtime/httpSmoke.ts`.

**Interfaces:** Setting-enable accepts optional `newsletter_address: string` for lab:newsletter. Plain enable only enables. `NewsletterService.address(ctx, provision, confirmedAddress?)` forwards the snapshot to `NewsletterRepo.address(userId, domain, provision, confirmedAddress?)`. Mismatch returns typed address_changed without inserting/reassigning a binding; malformed confirmation returns invalid_account.

- [x] Add/run RED tests for plain enable creating no binding, successful confirmed creation, stale full candidate, malformed confirmation, same-address repeat and existing-address preservation.
- [x] Implement the contract without changing schema/RSS or adding a creation route; pass focused regressions.
- [x] Update real HTTP smoke to explicitly confirm addresses and assert plain activation has no binding side effect; regenerate API artifacts with gen:all.

## Task 2: Accepted card and confirmation flow

**Files:** `apps/web/app/components/NewsletterAddress.vue`, `apps/web/i18n/locales/{en,zh}.json`, `apps/web/tests/unit/components/NewsletterAddress.spec.ts`.

**Interfaces:** No new public component props. Read current address through GET. For a new address, validate/preview the lowercase token and domain; freeze draft + owner/generation + full address on modal open. Read the existing Reader account from `/v1/user/userinfo`, because the lightweight `/me` identity omits it. Confirmation sets that account only if needed and submits the exact newsletter_address; no unrelated user-store refresh is required. Existing ready addresses bypass creation.

- [x] Add/run RED component cases for cancelled confirmation/no writes, frozen full address, duplicate-submit/pending feedback, occupied/reserved errors, retry, preference restoration and storage failure, owner/session changes and stale responses.
- [x] Implement the accepted native-dialog layout, field-associated errors, title/address/stable/support hierarchy and disclosure storage with no sensitive payload persistence. Use trusted local SVG geometry consistently with existing Web controls.
- [x] Pass focused component/Labs/Feed cases and verify actual browser light/dark/e-ink, desktop/768px/narrow, Chinese/English, focus/Escape and 10px hover padding.

## Task 3: Verification and local handoff

- [x] Run API/Web suites, relevant typechecks/lint/format, strict OpenSpec and actual fresh Worker/HTTP smoke. Preserve unrelated local resources and operator databases.
- [x] Complete a fresh read-only Bugs/Security/Compliance review, resolve Important issues and record current evidence/gaps.
- [x] Start or verify this worktree's API on localhost:8787 and Web on localhost:3000; provide concrete human acceptance steps. Do not push this UI revision to the existing PR before renewed hands-on acceptance.
- [ ] After the task PR merges, classify unfinished work and archive through the required documentation PR.
