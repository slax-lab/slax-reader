# Design

## Context

See proposal.md for motivation and approval history. The first slice removed five prefetch hints and separated pure text helpers but left static route byte totals unchanged. The saved `final` build is the comparison baseline for the additional slice; the original production base is retained separately.

`pages/b/[id].vue` statically imports both optional AI/chat panels. `SnapshotSidePanel` invokes their slots even while hidden by v-show. AI imports MarkdownText; chat imports the same full Markdown/KaTeX/highlighting renderer. A 535,314-byte gzip shared chunk remains in the article static closure. `components/Modal/index.ts` statically imports all six programmatic modal implementations.

## Goals / Non-Goals

Goals: remove optional implementations from the initial executable graph and from pre-use network downloads, keep real interactions unchanged, retain opened state, and report measured results.

Non-goals: changes to PowerSync construction, synchronization, recovery, account ownership, pending writes, schema/version gates, mobile behavior, SSR content, global navigation, reduced rendering features, manual chunk policy, new dependencies, service-worker or CDN settings. Do not change comment/transcript mounting merely for symmetry. Do not optimize a route with no evidenced opportunity.

## Decisions

### 1. Keep the completed initial slice

The source-identity filter for the four SQLite JS loaders and PowerSync websocket implementation still changes only prefetch. Unknown identities retain their hints; required preload, imports and emitted Worker/WASM files remain intact. Pure text functions retain their outputs and legacy parse re-exports.

### 2. Gate optional AI/chat panel activation at the article page

Use async component loaders and a page-local activated state. Before first accepted activation the panel is not instantiated; after activation it remains mounted while the existing container controls visibility. Existing automatic opening counts as genuine demand. Preserve entitlement checks before activation and the current default panel choice, desktop preference and mobile behavior. Do not move data needed for article or permission decisions into deferred UI.

Use a small wrapper/loading surface only if needed for recoverable chunk failures and deterministic readiness. An async import resolving is not sufficient to deliver an imperative quote; wait for the actual exposed component ref. The first authorized quote must be delivered exactly once after readiness, while failed/unauthorized actions must not be sent. Avoid arbitrary timeouts. Scope pending intent to the current page/account and discard it when that scope changes. Do not unmount on each tab switch: that alternative loses drafts and fetched state.

Keep the current rendering libraries and language coverage inside the deferred modules. Check the built dependency graph rather than assuming the async import is enough; other eager consumers can retain shared chunks.

### 3. Load programmatic modals on demand

Retain existing public entrypoint argument shapes and callbacks. Separate runtime constants/types exported by a modal from its heavy Vue implementation where needed. The mounting utility must preserve stable modal identity, original props, application context and focus behavior; simply wrapping every modal in an unnamed async component would break existing container naming/deduplication.

Load on a user action, deduplicate in-flight activation for the same modal identity, and use existing error feedback for a failed import. A failure must not create a permanent blank container or block subsequent retry. Avoid creating a generic modal framework. Initial loading must not pull every modal through the entrypoint barrel.

### 4. Preserve demand loading without speculative backfill

Inspect effective generated manifest and HTML after splitting. Extend the narrow hint helper only for positively identified optional UI entry modules if their unused implementations would otherwise be prefetched. Keep required preloads when the implementation is actually rendered, do not globally disable prefetch, and do not guess generated hashes. Verify the optional heavy renderer is neither in the ordinary article static closure nor requested before genuine demand.

### 5. Keep download failures outside the module cache

A real browser test demonstrated that retrying the same rejected dynamic import can reuse its failure without another request. The user directed the agent to continue fixing and exercising that failure rather than stop. The scoped build plugin therefore emits a unique per-build JSON index containing the emitted JS/CSS static dependency closure of each optional interface. Only an actual open action requests this index. No database assets, dynamic descendants such as Mermaid diagram engines, or global resource policy are changed.

Before invoking the existing importer, fetch all indexed resources successfully using the browser's immutable HTTP cache. Failed HTTP/MIME checks remove the failed request promise and do not execute import, so user retry makes fresh ordinary requests rather than reusing a failed module record. Successful resources and the index are reused for the page lifetime. The unmodified importer then evaluates the same URLs from cache, preserving shared module identity and original Vite CSS/dynamic-import behavior. Development, which has no emitted index, retains its direct loader.

This adds one small index request at first optional use and cached resource reads. It does not make network availability atomic: browser cache eviction or an outage between preflight and actual import remains a limitation; no automatic full-page reload, duplicated module graph, blob execution or cache-busting module identity is introduced. The demonstrated repeated HTTP failure case must pass for entry JS, a shared rendering dependency, stylesheet and modal.

### 6. Measure and exercise both changed boundaries

Use the same locked dependencies, minification and synthetic environment as the saved builds. Compare deduplicated imports/CSS closures separately from hinted resources and actual browser requests. Require a real article static-byte reduction; record zero savings on unaffected routes rather than widening scope.

Regression checks cover closed/open/reopened panels, automatic opening, entitlement denial, first quote before module readiness, initial loading failure/retry, and modal props/callbacks/deduplication/focus/dismissal. Exercise real production pages in the built-in browser with synthetic backend data. Verify selected database demand assets and the existing recovery controls remain unchanged. No real account mutations or production deployment are needed.

## Risks / Trade-offs

- First panel/modal open now waits for a chunk -> retain a clear existing-style loading/error path and retry, and verify the first action is not lost.
- Async panel lifecycle loses state -> mount once per page after accepted activation, then keep it alive.
- Permission or page changes while loading -> re-check the current scope before handing pending intent to a component.
- Other eager imports retain heavy libraries -> inspect the production closure and browser trace before claiming success.
- Source identities vary with bundling -> match demonstrated sources only and preserve unknown entries.
- Global modal utility affects more than four routes -> maintain its API and run related tests/consumer builds; no unrelated interface redesign.

## Migration and approval

The user approved this expansion on 2026-11-10 after the two boundaries and measurement requirements were presented. No optional requirements-discovery demo is needed for an unchanged layout; human hands-on acceptance of visible loading/error behavior remains required before a PR. Rollback removes the new lazy boundaries without clearing storage. No feature switch or data migration is introduced. The user subsequently requested a PR on `feat/lazy-load-bundle`, authorizing task commit/push/PR creation once required version and human hands-on decisions are recorded. Deployment and merge are not authorized.
