# Proposal

## Why

Under 3G with cache disabled, the reader displays sidebar buttons before their application handlers are ready. Clicking Analysis can leave the original toolbar unchanged with no acknowledgement; once interaction is ready, asynchronous AI and Chat code introduces another wait. The change requester accepts the waiting time and wants visible feedback throughout it.

## What Changes

- Immediately replace the clicked panel icon with a same-size loading ring, including clicks before application hydration finishes.
- Retain one pending panel choice during initial startup and deliver it once to the existing panel handler when the page is interactive. This is needed to avoid acknowledging a click that would otherwise be discarded.
- Keep the corresponding visible icon busy while AI or Chat component code loads; restore its ordinary icon on completion or failure. Preserve existing panel-content loading and error UI.
- Preserve current access checks, layout, wait durations, and AI content-generation indicators. Use a static loading cue in e-ink and reduced-motion modes.

## Capabilities

### New Capabilities

- `web-reader-panel-entry-feedback`: Acknowledgement and loading presentation at reader panel entry controls, including startup before hydration.

### Modified Capabilities

None. The separate `center-reader-panel-loading` change owns the `web-reader-panel-loading` content-placeholder capability; this change neither carries its delta nor changes placeholder positioning.

## Impact

Web-only: the existing early reader startup script, `/b/[id]`, and the right-edge, expanded-panel, and mobile toolbar icon consumers. No new dependency, API, Extension, CLI, or Mobile changes. Implementation uses a task branch from `origin/dev` and preserves unrelated local changes. This is a local loading-state adjustment, not a material UX restructure.

## Review status

On 2026-11-17, the change requester reviewed and approved this proposal and design in conversation and requested implementation, running-environment weak-network verification, and a pull request. This authorizes implementation; post-implementation hands-on acceptance remains required before opening the pull request.
