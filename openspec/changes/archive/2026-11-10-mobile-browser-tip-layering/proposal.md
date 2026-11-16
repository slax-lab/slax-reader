# Proposal

## Why

On the public subscription collection page (`/c/[id]`), the fixed header obscures the external-browser guidance card and can intercept its close control. The collection header uses layer 100 while the guidance uses layer 80 in the same layout stacking context.

On Web article detail pages, quoted tweets use a fixed pale-blue hover background that does not follow the active theme. Their 14px description text receives a generated line-height of 1 (14px), making multiline quotes cramped compared with nearby 20px social-post metadata.

## What Changes

- Raise the existing guidance card's z-index from 80 to 1000 on all eligible routes so its text and dismissal control appear above the collection header. Use one consistent layer without route-specific treatment.
- Guidance intentionally remains above in-page overlays at lower or equal layers in the same layout context, including the subscription modal at 100 and the collection-management backdrop/modal at 999/1000. Body-mounted modals retain their existing precedence through the outer application stacking context.
- Preserve the existing positioning, appearance, detection, route exclusions, gestures, and cooldown behavior.
- Verify overlapping hit targets in a rendered browser across mobile widths and themes.
- Use the existing semantic accent background for quoted-tweet hover feedback in light, dark, and e-ink themes.
- Keep quoted-tweet descriptions at the existing 14px metadata size and explicitly set their line height to 20px.

## Capabilities

### New Capabilities

- `web-quoted-tweet-presentation`: Theme-aware hover feedback and readable multiline descriptions in Web article quote cards.

### Modified Capabilities

- `in-app-browser-guidance`: Require eligible collection-page guidance and its dismissal control to remain above the page header.

## Impact

Runtime edits are limited to `apps/web/app/components/Tips/InAppBrowserTip.vue` and `apps/web/styles/article/_twitter.scss`. No header, shared token, API, dependency, or application version changes are needed. The unregistered `TweetQuoteInfo.ce.vue` component and Mobile's separate reader assets are outside this Web correction. Required OpenSpec artifacts and verification evidence accompany the fix.

## Scope review

On 2026-10-29, the requesting maintainer clarified that the affected surface is the user's subscription collection page, then explicitly directed raising the guidance popup's layer substantially and changing no other UI code. The maintainer later requested the quoted-tweet color and line-height correction in the same PR, and approved the concrete proposal to reuse the theme accent background and keep the description at 14px with a 20px line height. That addition expands the original runtime scope only for those two quote-card styles. These are conversation-level scope decisions; hands-on acceptance is recorded separately in validation.md.

This restores an existing local interaction and is exempt from the optional material-UX demo under DESIGN.md section 10.1.

On 2026-10-29, the PR review identified that the global layer also raises guidance above in-page subscription and collection-management overlays. The requesting maintainer explicitly confirmed that 1000 is correct, that covering the subscription modal is expected, and that route-specific treatment is not permitted. The final implementation therefore retains the uniform layer of 1000. This precedence change is intentional, not a promise to preserve the previous ordering of every in-page overlay. No header or modal component changes are part of this task.
