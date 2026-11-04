# Proposal

## Why

The Mobile Library has inconsistent control sizing, typography, source-strip spacing, and header icon treatment. Reader controls also need consistent selection/mark colors, centered notices, native setting switches, stable source avatars, and observable picker motion.

## What Changes

- Add visible pressed highlighting to enabled Reader More tiles, retaining their 56-point tile, 24-point action icon, labels, Pro badge, and disabled behavior.
- Make the iOS non-subscriber promotion content-sized and 36 points tall at the default text scale, with 8 points between the arrow frame and the trailing edge. Preserve font scaling and an accessible touch target.
- Give every Inbox/Starred/Archived/RSS list-picker label the same medium weight as the current header title (500), scoped to this picker.
- Center the complete avatar-and-label items within the Collection and RSS horizontal source strips. Use balanced vertical space and retain horizontal selection and article-list scroll behavior.
- Match the Library search icon's stroke, color, and optical center to the existing add-link icon. Audit adjacent Library and Reader controls at their actual sizes; additional unrelated artwork replacements require concrete findings and review.
- Use #FEEAC273 for Reader text selection and #CCB69AFF for annotation strokes, including the comment quote decoration.
- Use platform-native settings switches with #16B998FF on tracks and #0F141914 off tracks, preserving each existing setting controller and disabled/error behavior.
- Center Reader copy/image notices in their visible surface and use regular weight for new-tag input.
- Preserve source avatars across Collection/RSS selection and start the Library picker transition after native presentation.
- Normalize code-assigned green RGB values to #16B998, preserving their alpha. Exempt green embedded in image/icon artwork. Reader selection uses the explicitly requested warm-color exception.
- Withdraw the earlier article-copy-link change and retain the original native article-sharing logic, including image preparation, metadata and dismissal sequencing.

These are local corrections within the existing Library and Reader layouts. No new routes, dependencies, or global icon/theme redesign are proposed.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `mobile-visual-parity`: Explicit local presentation requirements for More press feedback, subscription promotion geometry, list-picker weight, centered source strips, matching Library action icons, warm annotation colors, code-assigned green normalization, native setting switches, centered notices and picker motion.
- `mobile-app-parity`: Preserve setting behavior through native controls and source-avatar continuity across list selection. Original sharing contracts remain unchanged.

## Impact

- Library screen, scoped `SourceMenu` label styling, `RssFeedSwitcher`, and `SearchGlyph`.
- Reader toolbar, notice composition, tag input, Mobile-scoped embedded-document styling, native selection tint, and native share success colors.
- Existing mounted UI and Reader action suites, plus native iOS/Android visual and clipboard verification.
- `DESIGN.md` records the approved Mobile presentation/color exceptions. Pinned shared reader assets and icon files remain unchanged; effective HTML colors are overridden within the Mobile document composer.
- Work uses `fix/mobile-library-reader-polish`, based on `origin/dev`, in the main checkout, as explicitly requested by the owner. All pre-existing changes remain outside this task.
- This follows the already merged `mobile-native-smoothness` (#400) and `mobile-ui-polish` (#452) implementations. Archive those predecessors before this change; do not run competing implementation work for their capabilities. Preserve their accepted toolbar geometry and scroll behavior.

## Review status

The owner approved the initial presentation changes and main-checkout implementation on 2026-11-03, preserving unrelated uncommitted work. In the follow-up, the owner approved the seven-item refinement plan and normalization of code-assigned greens while exempting icon artwork, and explicitly withdrew the copy-link sharing change. These decisions supersede the prior share proposal. Version 1.0.26, build 798, previous build 797 remains unchanged per the owner's decision. On 2026-11-03, the owner exercised the final main-checkout build locally, reported no remaining problem and authorized code review followed by a draft PR if no Important findings remain.

## Hands-on acceptance refinements

The owner requested five further corrections after inspecting the running app: compact Library picker edge padding (8 points), autofocus the feedback editor, restore search secondary text to #646B68, move search cell gutters inside their pressable bounds, and preserve rounded lower corners throughout the outline morph and panel crossfade. These refine the current change and supersede the blanket-green rule for search secondary text. Keep current controllers, content alignment, source selection, feedback submission and animation timing intact.

## Input and search acceptance refinement

The owner requested an Add URL-style Reader title editor (compact shell, close control, 8-point outlined input and full-width confirmation), 8-point search inputs, primary search text #333333 and secondary/placeholder text #999999, and #16B998 carets in every native Mobile input. These supersede the earlier #646B68 exception; Search submit text remains green. Keep the title draft and save callback, search/tag controllers and Reader document selection colors unchanged.

## Targeted search acceptance refinement

The owner requested text-only keyword clearing, Reader-style tag selection and selected-tag display, and larger supporting text matching Settings. Show keyword clear only for nonempty text and preserve independent tag/source filters when it is pressed. Use the Reader's warm outlined tag chips, selected/available groups and selected-chip removal, without introducing tag creation or changing existing search/tag callbacks or Done dismissal. Display selected tags as Reader-header-style outlined chips. Supporting search text formerly 11–13 points becomes 14/20, matching Settings; tag chip text retains the Reader 15/21 treatment. This supersedes the tag picker's former full-width checkbox-row presentation.

## Source-strip sizing acceptance refinement

The owner requested 22-point layout gaps between source items, 32-point avatar artwork, 10/14 names and a 4-point avatar/name gap in the Library Collection/RSS source strip. Keep the existing 72-point item width and 96-point default strip height; center the complete groups. The existing 3-point selection-ring clearance becomes a 38-point outer region (RSS includes its half-point border within that region). Preserve source selection, unread dots and horizontal scrolling. The owner subsequently approved a static #F5F5F3 background extending upward from each source strip by one measured list viewport height. Keep the decoration outside normal layout and input/accessibility, update its height only on viewport layout changes, and retain native bounce, scrolling and position restoration. The owner asked whether item width was 40 points; measured code uses 72 points and no width change was requested.


### Search alignment and initial feedback keyboard acceptance

The owner requested restoring the original 12-point Collection/RSS item gap while retaining all other source-strip refinements. Correct the Search tag toggle's optically low chevron, reduce the primary Search input from 16 to 15 points, and focus Feedback only after the keyboard-avoidance surface has its measured screen offset so the first keyboard presentation keeps both consent options visible. Preserve input/filter behavior, consent defaults, submission and native keyboard avoidance. The owner also requested a read-only audit of bridge provenance/history and Web preprocessing differences; do not synchronize or replace the bridge as part of this batch.


### Approved bridge synchronization

The owner approved synchronizing the imported programmatic-selection fix into the sibling slax-reader-web-bridge source and adding common image, empty-span, details, relative-link, table and iframe processing from the audited Web path. Rebuild upstream and synchronize its generated script and provenance into Mobile. Preserve native image actions, existing annotation selectors and unrelated uncommitted changes in both checkouts. Media-player/social-card processors and Web class isolation remain outside scope. This owner request approves implementation of the audit's specified subset.

### Approved Android annotation repairs

After the Android verification report, the owner explicitly requested fixing the intermittent annotation-bar omission following native text selection and the keyboard covering the comment sheet, followed by Android re-verification in the main checkout. Native selection takeover must flush an already-debounced pending range on touch cancellation; cancellation before debounce and programmatic-selection suppression must continue working. Enable Android keyboard avoidance for the existing inline comment sheet, preserving iOS behavior, draft/submit ownership, dismissal and the existing motion. Rebuild the bridge from its sibling source and regenerate Mobile assets. This request approves these two focused repairs; no structural UX change, new dependency or unrelated working-tree edit is included.

## Approved adaptive source widths (2026-11-03)

The owner approved implementing adaptive Collection and RSS item widths in the main checkout on both iOS and Android: minimum 38 logical points, one-line names capped at 72 points, and 22-point gaps between item layout bounds. Preserve existing avatars, typography, selection behavior, scrolling and unrelated uncommitted work. This supersedes the earlier fixed 72-point width and restored 12-point gap.

## Pre-PR owner acceptance

On 2026-11-03, the owner confirmed local hands-on acceptance after the accumulated Library, Search, Settings, Reader/annotation, feedback-keyboard and adaptive-source refinements: “本地看过，大概没什么问题了”. They explicitly authorized review and then a draft PR. The small review correction keeps the Debug environment checkmark visible against the normalized green selection background, using the existing primary text color. The change remains scoped to Mobile and the approved portable reader assets.

## CI review repair (2026-11-04)

The owner requested repairing PR #493's failing checks. The published-source pin resolves the bridge provenance gate. The next review identified the unintended loss of existing primary-button press feedback during green normalization. Restore that existing behavior with the neutral pressed overlay over #16B998, preserving geometry, actions, cancellation and disabled/busy presentation. This is a correction within the approved Mobile palette/interaction scope rather than a new button design.
