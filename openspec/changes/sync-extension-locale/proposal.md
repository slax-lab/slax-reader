# Proposal

## Why

The v2 Extension currently renders interface text in the browser language even when the same user selects another language in Web settings. Port legacy frontend PR #1615 so the Extension follows the account preference and updates open interfaces without interrupting reading, collection, comments, or chat.

## What Changes

- Port the feature from `unnoo/slax_reader_frontend` commits `b553ecb5` and `c1677360`, including the correction that validates the backend's `code: 200` response envelope.
- Make successful Web language saves notify the Extension to re-read the account preference, with ordered saves and protection against stale account, token, and offline fallback results.
- Add an account-scoped Extension locale cache, lifecycle refresh, safe message relay, and reactive translations for open interfaces and context menus.
- Preserve browser-language fallback, existing translation dictionaries and placeholders, ongoing operations, and independent AI-language settings.
- Adapt imports, tests, build fixtures, and package exports to v2 rather than copying legacy application configuration.

## Capabilities

### New Capabilities

- `account-locale-sync`: Account language persistence and safe propagation from Web to Extension, including fallback, session isolation, reactive rendering, and recovery.

### Modified Capabilities

None. Existing living specs do not define account locale synchronization.

## Impact

- Web: `apps/web/app/stores/user.ts`, Pinia plugin, language selector, layout, request helpers, and related tests.
- Extension: background/session services, content script, translation runtime, translated components, dictionaries, request headers, and tests.
- Shared frontend implementation: `packages/frontend-types` for locale messages and snapshots; `packages/frontend-utils` for response typing. Existing HTTP contracts stay in `packages/contracts`.
- Reuse `/v1/user/me`, `/v1/user/setting`, and `/v1/user/refresh`; no backend API, database, production dependency, or permission expansion is required.
- Preserve the separate Web and Extension design profiles defined in root `DESIGN.md`.

## Non-goals

- Translating article content, saved comments, or generated AI responses; changing `ai_lang`; changing Chrome-owned interface language or manifest localization.
- Importing other legacy PRs, redesigning components, changing deployment, or publishing an extension release.

## Review and source status

The user approved this proposal on 2026-10-10 and requested a PR first. The initial Draft PR contains planning artifacts only; product implementation remains pending. GitHub CLI verification on 2026-10-10 confirmed that PR #1615 contains both source commits and has head `c1677360ceb10a31835666e0e497892f688408d2`. The isolated task branch starts at verified remote `dev` commit `8682a738baa11aaff84167c9169ea7e8dc7a2eee`. Recheck these refs when implementation starts if either branch has advanced.
