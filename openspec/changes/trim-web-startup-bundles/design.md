# Design

## Context

The user explicitly rejected the bespoke loading infrastructure on 2026-11-11 and requested official Vue/Nuxt mechanisms instead. This supersedes the prior generated-resource-index and preflight design in PR #560. The branch remains `feat/lazy-load-bundle`; keep the separately merged login-startup work intact.

## Route boundary

Panel deferral is restricted to `/b/:id`, within the four routes the user selected (`/b`, `/c`, `/login`, `/`). `/s/:id` keeps its static panels and is not a measured optimization target. Do not expand its interaction model to satisfy wording that accidentally omitted this boundary. Shared composable changes must continue to support its existing `isAppeared` false-to-true path.

## Decisions

- Article AI/chat panels use Vue `defineAsyncComponent` with literal dynamic imports, the existing DotLoading component, a 15-second timeout, and `suspensible: false`. The existing panel selection and permission rules determine when `v-if` renders them.
- Vue `KeepAlive` retains each panel instance while its tab is inactive. The chat uses `onActivated`/`onDeactivated` alongside its existing visibility watcher to restore focus, bottom-follow state and open/expand analytics exactly once per appearance. Key the containing boundary by account generation so cached state does not cross accounts. No custom component cache or load wrapper remains.
- Nuxt `NuxtErrorBoundary` contains a panel failure without replacing the article. The error slot offers the official `reloadNuxtApp` action with an explicit warning that unsaved drafts will be lost. Reload is user-initiated only. Do not claim that retrying the same dynamic import clears a browser's failed module cache.
- Programmatic modal functions use ordinary JavaScript `import()` directly, then the existing modalBootloader in Nuxt context. Import rejection shows the existing toast with the same reload/unsaved-state warning. Existing inputs, callbacks and dismissal behavior remain unchanged; no shared pending-request map or modal loading framework is added.
- One configuration statement in Nuxt's documented `build:manifest` hook sets generated resource `prefetch` flags false. This explicitly disables speculative HTML resource hints globally; required `preload`, static/dynamic imports, Worker/WASM files and NuxtLink route-prefetch behavior remain unchanged. Prefer this transparent configuration trade-off over a custom package classifier, bundler plugin or dependency graph walk.
- The existing bookmark composable queues only user quote intent until the real chat ref exposes addQuoteData. The queue is consumed once and cleared on account/scope changes. This is necessary application behavior, not a resource loader.
- A pre-existing immediate chat watcher called addLog before its const declaration when mounted already visible. Move the unchanged callback before the watcher and cover that initial state in the existing tests.

## Recovery-state presentation

During hands-on preparation the user reported that the reload controls were unstyled and did not respect the existing design. Correct this locally rather than redesigning the reader: use the same 24px sidebar padding and auxiliary sans-serif text as the existing unavailable state, plus the established bordered secondary-button pattern. The reload action is not a new prominent primary action.

Use existing `--slax-text`, `--slax-text-muted`, `--slax-border-strong`, `--slax-surface-solid`, `--slax-surface`, `--slax-accent`, `--slax-accent-bg`, `--slax-radius-sm`, `--slax-fs-aux` and `--slax-font-sans` values. Provide a 44px minimum hit height, visible keyboard focus, hover and pressed states. Add no raw color, new icon, shadow or animation. Keep the warning and user-initiated reload semantics unchanged. Verify the same error state in light, dark and e-ink, at desktop and narrow mobile widths, before asking for acceptance again. This is an existing-pattern correction under DESIGN.md §10.1, not a new layout requiring a separate discovery demo.

## Removed infrastructure

Delete DeferredSnapshotPanel.vue, deferredUi.ts, deferredModal.ts, both custom resource-hint helpers, their specialized tests, the generated dependency-index build plugin, the index fetch, resource prefetch loop, custom promise cache and related compile-time define. No replacement resource-index format, blob loader, fetch-before-import system or module URL rewriting is introduced.

## Boundaries and verification

Keep the pure text entrypoint and legacy exports, rendering language coverage, permissions, SSR content, database identity, sync policy, uploads and Worker recovery unchanged. The Extension remains 1.16.3.

Verify standard tests/typecheck/build, absence of the removed symbols and generated index, no optional-panel startup requests, first-use quote delivery, KeepAlive draft retention, user-initiated failure recovery, and unchanged Worker asset index. Measure the new production closure against the saved integrated build on the same dependency/base configuration. Record full-lint baseline failures and remote-service limitations honestly.

## Official references

- Vue async components: https://vuejs.org/guide/components/async.html
- Vue KeepAlive: https://vuejs.org/guide/built-ins/keep-alive.html
- Nuxt error boundary: https://nuxt.com/docs/4.x/api/components/nuxt-error-boundary
- Nuxt lifecycle hooks: https://nuxt.com/docs/4.x/api/advanced/hooks
- Nuxt reloadNuxtApp: https://nuxt.com/docs/4.x/api/utils/reload-nuxt-app

## Delivery

Update existing PR #560 without changing its owner-selected draft/ready state. Do not infer human hands-on acceptance, merge, deployment or archive authorization from this implementation request. The user explicitly authorized removing the old machinery and using the official behavior, including removing the previous same-document recovery promise.
