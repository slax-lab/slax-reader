# Design

## Context

See proposal.md for intent and the browser reproduction. In `origin/dev` at `82b84500`, `SnapshotRightEdgeToolbar` emits a panel choice and `/b/[id].vue` sets `activePanel` without awaiting an import. AI and Chat use `defineAsyncComponent` with a content-area loading component, a 15-second timeout, and error boundaries. Other panels and the shell are statically imported. The outer toolbar disappears when the panel opens, so a control-only change there would miss the later wait.

`readerStartupScript` in `apps/web/app/utils/readerStartup.ts` already runs as a critical inline head script from `nuxt.config.ts`, before delayed application modules. It currently records reading/navigation intent. The opt-in reader-startup lab can hold the real client entry module and exercise the actual reader.

## Goals / Non-Goals

**Goals:** Acknowledge a panel click before hydration, hand that exact intent to the real page handler, and maintain visible icon feedback through asynchronous component loading.

**Non-Goals:** Faster startup, different subscription or login policy, general DOM event replay, global loading infrastructure, new dependencies, changes to content generation, or relocation of content placeholders. Existing `center-reader-panel-loading` work remains independent: its `web-reader-panel-loading` delta and loading wrapper are not edited here.

## Decisions

1. **Use the existing early startup script for one narrow intent.** Mark existing panel buttons with their finite `SnapshotPanelId` and stamp their article container with its immutable setup-time route path. The listener accepts only buttons whose article path matches its destination, so controls in a still-visible source article remain with that article during async navigation. Before the reader page declares interaction ready, a delegated activation listener records only the latest panel id and article path and exposes a transient document-root loading marker. It does not import a panel, inspect account data, or open anything itself. Ignore repeated activation of the same pending choice. Replace it when another panel is chosen; clear it on article navigation. Once the page mounts, remove the early interception and consume the pending choice once through `onUserPanelChange`, after the existing mounted `panelOpen` reset. Normal gates decide whether it opens. Mark the manual choice before automatic-panel selection can override it.

2. **Keep the early presentation outside Vue-owned DOM state.** The temporary document-root marker drives CSS against stable, server-rendered icon markup. Do not replace child nodes or change Vue's server-rendered component structure before hydration. Render translated loading text with the controls so the early busy presentation can expose it without waiting for application code; once mounted, Vue owns the usual busy attributes and labels. Remove the marker as normal reactive state takes over, without a blank feedback frame. The early script and helper must remain self-contained and bounded to reader panel entries.

3. **Track module loading at the existing async wrappers.** Keep a pending flag for each existing AI and Chat loader. Set it when the loader runs and clear it on resolve or rejection while propagating errors to the existing error boundary. Clear the visible busy flag on the existing 15-second timeout as well; a permanently pending import must not leave the control spinning after the error UI appears. The visible state is the selected panel's pending code load, not subscription verification or generated-content fetching. Closing or switching panels never waits for the module. Do not add retries, minimum spinner duration, or forced imports.

4. **Share only the repeated icon presentation.** Add `apps/web/app/components/Snapshot/SnapshotPanelIcon.vue` for the ordinary `AppIcon` and a same-size CSS loading ring. Consume it from `SnapshotRightEdgeToolbar.vue`, `SnapshotSidePanel.vue`, and the mobile panel entries in `SnapshotBottomToolbar.vue`; keep their existing 20px/18px icon sizes and 44px button geometry. Existing ordinary icons remain registry-backed; the CSS ring requires no imported SVG or generated registry changes. The ring sets `color: var(--slax-accent)` and paints its border with `currentColor`, following the change requester's 2026-11-17 follow-up; ordinary icons retain their existing control color. Reuse translated action/loading labels and local reduced-motion styling; preserve the global e-ink animation suppression. Only visible controls for the selected pending panel show code-loading feedback.

## Approaches considered

- **Vue-only loader flags:** smallest implementation, but cannot acknowledge the reproduced click before application handlers exist.
- **Show every entry as busy before hydration:** avoids retaining intent, but replaces idle icons even without a click and still makes users click again. It does not match the requested click feedback as closely.
- **Early, single-choice handoff plus normal loader flags (proposed):** a small extension of an already-shipped startup mechanism covers both observed waits. Recording the choice is an explicit behavior addition so a spinner never acknowledges a discarded click.

## Risks / Trade-offs

- **Hydration mismatch:** mutate only an out-of-root transient presentation marker; retain identical component child structure, and verify the actual held-entry hydration with console warnings captured.
- **Duplicate or stale activation:** use one latest choice tied to its article, end interception before consumption, and exercise repeat clicks, different choices, route changes, and initialization auto-open ordering.
- **Access regression:** consume intent through the existing page path, then verify pending, inactive, failed, and active subscription states in the real-reader lab; the inline script never interprets authorization.
- **Invisible mobile controls:** preserve current responsive visibility. Pre-hydration feedback is required where a control already exists; do not introduce another mobile entry or change server-side layout to create one.
- **Existing loading-center change:** preserve whichever content-area loading component is present when implementing, and resolve shared-file changes without duplicating its capability delta.

## Verification and delivery

Use the real-reader lab with the client entry response held: click an SSR-rendered entry, observe the ring before releasing JavaScript, release it, and verify exactly one normal activation. Independently hold AI/Chat module delivery and verify the transition to expanded tabs, release, rejection, and timeout. Test at 1280px, 768px, and 375px in light, dark, and e-ink themes and reduced motion; use only existing visible entries at each width. Verify a later real 3G smoke check when the implementation is available in the running environment. Record evidence in this change's `validation.md`; human hands-on acceptance precedes a PR.

No migration is required. Rollback removes this narrowly scoped feedback and startup handoff; data and APIs are unchanged. Only Web output is affected, so CLI, Extension, and Mobile version prompts do not apply to this scope.
