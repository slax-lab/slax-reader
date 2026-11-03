# Design

## Context

See `proposal.md` for scope and the owner's confirmed share behavior. Inspection at `656b9bcb` established:

- `ReaderToolbar` uses a static Pressable style and a static tile background; it never consumes `pressed`.
- The Library promotion already has `minHeight: 36`, but stretches itself and gives its text `flex: 1`. Its horizontal padding is 12. The reported short appearance has not been reproduced natively; the existing minimum is not proof of the visible runtime height.
- The header uses weight 500; `SourceMenu` uses the shared weight-400 menu typography.
- Collection and RSS source strips are 96 points tall with 12 points above and 16 below their contents. Collection additionally relocates those insets to the outer Android container. A complete default item is 48 + 6 + 14 = 68 points.
- Search is a View-drawn 24-point glyph with a 1.8-point stroke in `C.text`; add-link uses a 96-pixel source bitmap in a 24-point frame. Both buttons already center their 24-point frames inside 44-point targets. Frame centering alone does not align visible artwork.
- Share constructs the correct Slax detail URL, queries Reader images, resolves a share image, and invokes the native article-share adapter. It does not copy to the clipboard or show a copy toast. The reported native no-response failure has not been reproduced; waiting for this pipeline is unnecessary for the newly selected behavior.

## Goals / Non-Goals

**Goals:** Keep changes local, use existing Mobile tokens and installed clipboard support, preserve native dismissal ownership, and make the approved presentation and interaction corrections directly inspectable.

**Non-Goals:** Replace the icon library, change server access/sharing settings, redesign navigation, or remove native adapters still needed by image or diagnostic sharing. Copying a link does not grant public access or change its server permissions.

## Decisions

### Local press feedback

Use the Pressable child render state to overlay the existing `C.pressedOverlay` on the 56-point icon tile. Keep the icon, Pro badge, label, dimensions, and action dispatch unchanged. Disabled actions retain their opacity and cannot acquire an enabled pressed appearance. No gesture library or new timing abstraction is needed.

### Content-sized subscription promotion

Use start alignment, non-expanding text, 12-point leading padding and 8-point trailing padding. Preserve the 16-point leading icon, 20-point arrow frame, and existing 10-point gaps. At default text scale the painted strip measures 36 points high; provide a minimum 44-point touch region through local layout/hit slop. Allow height growth for increased text scale instead of clipping text. Confirm the actual native bounds before claiming the user's height issue resolved.

### Scoped list-picker typography

Pass a small optional label-style override through `SourceMenu`, used by the Library list picker to set weight 500. Leave the global `T.menu` token unchanged because row menus and RSS action menus are not requested to change. Keep the existing picker font size, selected check, dismissal, and action behavior.

### Center complete source items

At default scale center the 68-point avatar-label group within 96 points, yielding 14 points above and below. Apply equivalent geometry to the Collection Android outer container and the RSS switcher. Center measured/scaled groups and permit the strip to grow when needed for accessibility text; keep each group's internal 6-point gap. Retain the separate article gap, empty-Collection omission, unread dots, horizontal scroll, selection, and existing header-height measurement.

### Match visible header artwork

Keep the original add bitmap unchanged. Measure its painted bounds, stroke, and color at 24 points, then adjust the app-owned search drawing to that reference and center its visible bounds in the same frame. Reuse the appropriate Mobile color role. SearchGlyph also appears in the Search input and empty state, so inspect those callers after adjustment. Audit adjacent Library/Reader icons without globally rescaling imported assets or mixing platform icon families. Any additional artwork replacement outside the named pair is reported for scope review first.

### Restore sharing and center existing notices

Remove this task's clipboard article action, its link-copied localization/state, and its replacement tests. Restore the original image/title/URL preparation and native share adapter exactly. Reuse the existing notice presentation for selection/comment copying and image save/share feedback with an absolute-fill, non-interactive center container, instead of a fixed top offset. A gallery notice centers in its own overlay.

### Warm annotation colors and normalized code greens

Mobile tokens own #FEEAC273 selection and #CCB69AFF stroke colors. Apply them to PDF, comment quote lines, and an app-owned HTML presentation override inserted after pinned embedded styles. Keep the pinned shared assets byte-for-byte unchanged and preserve source alpha for timestamp/action greens. iOS native selection tint follows the warm selection hue; UIKit's own highlight compositing must be checked natively. Existing mark-highlight backgrounds are otherwise unchanged. All other audited code-assigned greens become #16B998 with their existing alpha, including native share success state. Imported PNG/icon colors remain intact.

### Native settings controls

Replace only SourceSwitch presentation with React Native Switch, which renders the platform native control. Keep its value/onChange/disabled contract and the existing RSS, PDF, system discovery, system donations and debug prototype controllers. Supply track colors and the iOS off-track background explicitly. Verify success, rejection, loading, rapid input and persisted settings through the actual settings harness.

### Stable avatars and visible picker animation

Collection selection currently changes the FeedList key, remounting its header and avatar hooks. Retain the native list per account; identify replaced content through contentScope and the existing explicit scroll reset so native row anchoring does not carry across sources. Keep real account replacement remounts. RSS already uses stable source keys; verify that continuity too. Do not add another image cache.

SourceMenu currently starts its entrance before Modal onShow. Start the animation only after native presentation, retain exit/reversal cleanup and reduced-motion handling, and add a subtle vertical transition for the Library picker. Keep unrelated menu placement and selection callbacks intact. New-tag input changes from weight 700 to 400 only.

## Risks / Trade-offs

- Native font metrics and bitmap optical alignment differ by platform → compare actual iOS and Android renders at default and increased font scale, in Chinese and English; unit styles are supporting evidence only.
- Native switch events and asynchronous setting writes → preserve the current controller callbacks and verify busy/rejection/persistence behavior.
- Retaining a list through source changes can preserve an old anchor → disable native visible-position adjustment while contentScope changes, reset explicitly, and test retired source callbacks.
- Green normalization brightens existing dark search text → retain the explicit owner-selected RGB, record the visual change, and verify legibility natively.
- Earlier merged changes have unarchived deltas for the same capabilities → sequence archival of `mobile-native-smoothness` before this change, and preserve `mobile-ui-polish` toolbar geometry. Reconcile updated main specs before archiving this change; do not archive predecessors around unchecked tasks.

## Verification and delivery

Use existing Reader mounted tests for the changed side effects and existing UI checks for regression coverage. Avoid new source-text tests that merely repeat numeric style constants. Run `pnpm mobile -- check`, `pnpm mobile -- bundle`, strict OpenSpec validation, and `git diff --check`. Exercise the affected controls and restored native Share in a running native app, and capture representative before/after evidence outside git. Record platform gaps explicitly in `validation.md`; obtain hands-on acceptance before a PR and a Mobile version decision before commit/push/handoff. This change needs no data migration; rollback is the task diff.

## Hands-on acceptance refinements

The owner requested five further corrections after inspecting the running app: compact Library picker edge padding (8 points), autofocus the feedback editor, restore search secondary text to #646B68, move search cell gutters inside their pressable bounds, and preserve rounded lower corners throughout the outline morph and panel crossfade. These refine the current change and supersede the blanket-green rule for search secondary text. Keep current controllers, content alignment, source selection, feedback submission and animation timing intact.

## Input and search acceptance refinement

The owner requested an Add URL-style Reader title editor (compact shell, close control, 8-point outlined input and full-width confirmation), 8-point search inputs, primary search text #333333 and secondary/placeholder text #999999, and #16B998 carets in every native Mobile input. These supersede the earlier #646B68 exception; Search submit text remains green. Keep the title draft and save callback, search/tag controllers and Reader document selection colors unchanged.

## Targeted search acceptance refinement

The owner requested text-only keyword clearing, Reader-style tag selection and selected-tag display, and larger supporting text matching Settings. Show keyword clear only for nonempty text and preserve independent tag/source filters when it is pressed. Use the Reader's warm outlined tag chips, selected/available groups and selected-chip removal, without introducing tag creation or changing existing search/tag callbacks or Done dismissal. Display selected tags as Reader-header-style outlined chips. Supporting search text formerly 11–13 points becomes 14/20, matching Settings; tag chip text retains the Reader 15/21 treatment. This supersedes the tag picker's former full-width checkbox-row presentation.

## Source-strip sizing acceptance refinement

The owner requested 22-point layout gaps between source items, 32-point avatar artwork, 10/14 names and a 4-point avatar/name gap in the Library Collection/RSS source strip. Keep the existing 72-point item width and 96-point default strip height; center the complete groups. The existing 3-point selection-ring clearance becomes a 38-point outer region (RSS includes its half-point border within that region). Preserve source selection, unread dots and horizontal scrolling. The owner subsequently approved a static #F5F5F3 background extending upward from each source strip by one measured list viewport height. Keep the decoration outside normal layout and input/accessibility, update its height only on viewport layout changes, and retain native bounce, scrolling and position restoration. The owner asked whether item width was 40 points; measured code uses 72 points and no width change was requested.


### Initial feedback focus sequencing and Search refinements

Restore only item-layout gaps to 12 points. Keep 72-point item widths, avatar/label sizes and static upward coverage. Search keyword text/placeholder use 15-point type; compensate the downward chevron's painted-bounds offset inside its existing centered frame without changing hit areas. Feedback removes native mount-time autoFocus and waits for the native opening transition to finish, then remeasures the settled screen offset and focuses through its input ref after KeyboardAvoidingView receives that offset. Layouts during the opening transition must not initiate focus. Later measurements must not reopen the keyboard. This avoids the first keyboard event using unmeasured avoidance geometry; no timers, synthetic keyboard events or replacement layout system are introduced.


### Portable bridge source and Mobile integration

Make TypeScript in the sibling bridge authoritative for the imported anchor-selection suppression behavior. Common processors retain article node identity; table fitting uses a CSS class rather than wrapper insertion. Relative links and host-specific image normalization receive the original source URL through InfoPack. Preserve cached image completion, recovery and native image-click messages; late InfoPack must not destroy authored WeChat image dimensions. Table/image observers have an explicit bridge disposal owner, invoked by Mobile teardown. Add the table-fit CSS contract in Mobile's existing presentation override. Lower only the imported stylesheet's default image-width priority so authored image widths actually survive; retain the video rule unchanged. Rebuild the script through upstream Rollup, record source/build hashes, and run Mobile's embedding generator; do not hand-edit generated payloads. Keep original import provenance in each deliberately updated asset entry and leave other assets unchanged. No media-player pipeline changes are included.

### Android native selection cancellation and comment keyboard avoidance

Route native `touchcancel` through the existing pointer-release handler. If selection debounce completed while the pointer was down, cancellation must flush that pending selection exactly once; otherwise the existing debounce remains responsible for delivery. Retain range deduplication, subsequent gestures and programmatic suppression. Fix this in the upstream bridge, then rebuild/synchronize its artifact and provenance rather than patching bundled JavaScript.

Use the installed React Native KeyboardAvoidingView height behavior on Android for the existing inline Reader sheet, matching the established Feedback approach. Keep iOS padding behavior and the current sheet animation, bottom inset, editor and controller ownership. Exercise the installed RN implementation with changing keyboard geometry, hide/restoration and an already resized native parent, then verify native editor/Send bounds above the visible keyboard. No new keyboard manager or manual inset subscription is introduced.

## Adaptive Collection and RSS source widths

Use intrinsic name sizing with a 38-point minimum item width, a 72-point name cap and 22-point flex gaps. Keep the 32-point avatar inside its existing 38-point selection clearance. Reserve label width at weight 500 using the platform text renderer and paint the current 400/500 label in that frame, so selection cannot resize or move adjacent items. The measurement is hidden from accessibility and pointer input. Reuse SourceLine on both platforms and both source strips; preserve middle truncation, increased text scale, avatar component identity and native scrolling. Native verification must include short and long names, selection and horizontal scrolling on both platforms.
