# Proposal

## Why

Opening Outline or Chat before its JavaScript finishes downloading displays four loading dots against the sidebar's top-left corner. Slow networks expose a missing layout for this existing loading state.

## What Changes

- Center the existing four-dot placeholder horizontally and vertically within the sidebar content area while an Outline/Summaries or Chat panel component loads.
- Preserve the loaded panels' layout, inline loading indicators, subscription checks, navigation, and article positioning.
- Verify both panels at narrow mobile, 768px, and desktop widths in light, dark, and e-ink themes.

## Capabilities

### New Capabilities

- `web-reader-panel-loading`: Presentation of the reader sidebar while an on-demand panel component loads.

### Modified Capabilities

None. Existing AI access, generation, and reader navigation requirements retain their behavior.

## Impact

Web-only: a dedicated sidebar loading component and the two asynchronous component declarations in `/b/[id]`. No API, dependency, shared-package, Extension, CLI, or Mobile changes; Web has no package-version increment.

## Proposal review

On 2026-11-17, the change requester reviewed the conversational proposal to add a full-content-area loading wrapper shared by Outline and Chat, preserving the generic dot component and existing behavior, and requested implementation and a pull request. These artifacts record that approved scope. This is a local presentation correction, not a material UX restructure. Post-implementation hands-on acceptance remains required before opening the pull request.
