# Proposal

## Why

On the public subscription collection page (`/c/[id]`), the fixed header obscures the external-browser guidance card and can intercept its close control. The collection header uses layer 100 while the guidance uses layer 80 in the same layout stacking context.

## What Changes

- Raise only the existing guidance card's z-index from 80 to 1000 so its text and dismissal control appear above the collection header.
- Preserve the existing positioning, appearance, detection, route exclusions, gestures, and cooldown behavior.
- Verify overlapping hit targets in a rendered browser across mobile widths and themes.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `in-app-browser-guidance`: Require eligible collection-page guidance and its dismissal control to remain above the page header.

## Impact

The sole runtime edit is `apps/web/app/components/Tips/InAppBrowserTip.vue`. No header, shared token, API, dependency, or application version changes are needed. Required OpenSpec artifacts and verification evidence accompany the fix.

## Scope review

On 2026-10-29, the requesting maintainer clarified that the affected surface is the user's subscription collection page, then explicitly directed raising the guidance popup's layer substantially and changing no other UI code. This records that conversation-level scope decision; it does not claim post-implementation hands-on acceptance.

This restores an existing local interaction and is exempt from the optional material-UX demo under DESIGN.md section 10.1.
