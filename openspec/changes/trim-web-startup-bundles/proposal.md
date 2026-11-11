# Proposal

## Why

Optional article panels and programmatic modals unnecessarily contribute to initial Web loading. The first implementation in draft PR #560 added custom resource-index, preflight and wrapper machinery; on 2026-11-11 the user explicitly requested deleting all of it and using official framework mechanisms.

## Scope

The user explicitly narrowed optimization targets to `/b/:id`, `/c/:id`, `/login`, and `/` (`/bookmarks`). Optional AI/chat panel deferral applies to the snapshot reader `/b/:id` only. The legacy share reader `/s/:id` is outside this panel-loading change and retains its existing static panel imports and mounting behavior. Its sole page-local edit is a behavior-preserving pure-text import; shared helpers and the global resource-hint setting can still affect it. No share-reader bundle reduction or full browser acceptance is claimed.

## What Changes

- Use Vue defineAsyncComponent and conditional rendering for AI/chat panels; use KeepAlive for their page-local state. Preserve automatic-opening and authorization decisions.
- Use direct JavaScript dynamic imports for programmatic modal implementations and retain their original mounting, props and callback behavior.
- Use NuxtErrorBoundary for local panel errors and reloadNuxtApp only on explicit user action, with an unsaved-draft warning. No custom same-page module-cache recovery promise remains.
- Use one build:manifest configuration statement to disable speculative HTML resource prefetch globally while preserving required preloads, imports and NuxtLink behavior. This broader scheduling trade-off is explicit, replacing the removed custom classifiers and graph walker.
- Retain dependency-free text extraction and compatible legacy exports; keep only business quote readiness/account-scope handling. Fix the existing chat immediate-watcher declaration order required for first-visible mounting.
- Delete both custom resource-hint helper files, DeferredSnapshotPanel, deferredUi, deferredModal, their tests, the index generator and preflight requests.

## Capabilities

### New Capabilities

- `web-resource-hints`: Avoid speculative resource downloads and initial optional-interface execution using supported framework mechanisms, preserving user-facing business behavior.

### Modified Capabilities

None. Synchronization, authorization, article content and rendering feature contracts remain unchanged.

## Hands-on feedback

The user requested preparing extreme-condition pages for personal inspection, then reported that the reload buttons were unstyled and inconsistent with the established Web design. This revision corrects the existing error slots using current sidebar spacing, semantic theme tokens and bordered secondary-button patterns. It does not redesign the reader, introduce a new component/loading framework or change recovery behavior. Human acceptance is still pending the corrected light/dark/e-ink and narrow-screen states.

## Impact

Changes are limited to Web panel/modal entrypoints, the existing bookmark composable, one build hook, error strings and associated tests, plus the original shared text extraction. No new dependencies, manual vendor chunks, generated runtime index, browser fetch loader, mobile sync disablement, database cleanup or CDN configuration.

The shared text change retains old exports; Extension source/version stays 1.16.3 per the no-bump decision. Work remains on `feat/lazy-load-bundle` in `.local/web-bundle-minimal-worktree`, based on dev 6016ee48 with the independent login-startup optimization preserved.

The user authorized updating the same PR; its owner-selected ready/draft state does not establish hands-on acceptance. Human hands-on acceptance is not inferred; no merge, deployment or archive is authorized. Old measurements and same-document recovery evidence are historical and must not be presented as results of the official-only revision.
