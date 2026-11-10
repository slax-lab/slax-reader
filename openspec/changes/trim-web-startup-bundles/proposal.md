# Proposal

## Why

The production Web build speculatively downloads five database alternatives and eagerly imports optional interface implementations. The first approved slice removed the five hints, but route-level static byte totals did not decrease. The user explicitly requested actual first-screen slimming and approved the additional panel/modal boundaries on 2026-11-10.

## What Changes

- Retain the source-specific database prefetch exclusions and dependency-free text entrypoint already implemented, with legacy exports intact.
- Load the article AI and chat panels only when selected by the user or existing automatic-opening rules. Keep a successfully opened panel mounted for the page lifetime so switching or closing does not discard drafts, fetched results or conversation state.
- Preserve authorization, automatic panel selection and the first quote-to-chat interaction while a panel is loading. Loading failure must remain recoverable without replacing the readable article.
- Load programmatic modal implementations only when their corresponding action is invoked. Preserve existing call signatures, props, callbacks, focus and dismissal behavior. Do not request optional implementations through speculative hints before use.
- Compare the updated production output with both the original base and the completed minimum slice for `/login`, `/b/:id`, `/c/:id` and `/` (`/bookmarks`). Verify static code actually leaves initial dependency closures and browser requests are deferred until demand.
- Do not change PowerSync initialization/synchronization, mobile policy, storage, supported Markdown/highlight languages, SSR article content, PWA/CDN behavior, or introduce manual vendor chunks or new dependencies.

## Capabilities

### New Capabilities

- `web-resource-hints`: Avoid speculative database alternatives and unnecessary initial downloads of optional interfaces, preserving demand-loaded functionality and stored state.

### Modified Capabilities

None. Existing reading, authorization, rendering and synchronization contracts are retained; the new requirements govern when optional interface resources load.

## Impact

- Initial slice: `apps/web/config/resource-hints.ts`, Nuxt hook, shared `frontend-utils/text`, legacy re-export and three extraction-only Web consumers.
- Approved extension: article AI/chat imports and activation boundaries; quote readiness handling; modal entrypoints and their mounting helper; narrowly scoped hint classification where needed; existing Web tests and browser fixtures. Prefer page-local panel gating over changing all users of the shared side-panel container.
- `/c` and the library benefit from deferred common modals if those implementations leave their closures. `/login` remains a regression control; do not invent a benefit or perform an unrelated rewrite. Shared modal consumers on other routes require regression checks, not a redesign.
- Worktree `.local/web-bundle-minimal-worktree`, branch `perf/trim-web-startup-bundles`, original base `bbd8fbb3718f2786eea84ffc2ede90ff5de0de80`. Prior worktrees remain untouched.
- The measured article shared chunk is 1,724,038 raw bytes / 535,314 gzip bytes. This identifies a target, not a guaranteed reduction; only a rebuilt graph and real browser exercise establish savings. Initial-slice measurements remain historical evidence in validation.md.
- User confirmed the proposed expansion with "改" after reviewing the two concrete boundaries. Implementation is authorized. The user subsequently requested a PR on `feat/lazy-load-bundle`; commit, push and PR creation are authorized once required version and human hands-on decisions are recorded. Deployment and archive are not authorized. No visual redesign is proposed. Any UI-visible loading-state change still requires human hands-on acceptance before a PR. The outstanding Extension version decision from the shared helper slice remains open.
