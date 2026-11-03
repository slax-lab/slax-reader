# Spec Delta

## ADDED Requirements

### Requirement: Reader More actions provide pressed feedback

Every enabled Reader More action SHALL visibly highlight its icon tile while pressed and return to its resting appearance when released or cancelled. The existing 56-point tile, centered 24-point icon, label spacing, Pro badge placement, and action behavior SHALL remain intact. Disabled actions SHALL retain their disabled appearance and SHALL NOT activate or display enabled press feedback.

#### Scenario: A More action is pressed or cancelled
- **WHEN** a user presses an enabled action in the Reader More panel
- **THEN** its tile visibly highlights during the press
- **AND** release activates the action once, while cancellation restores the resting appearance without activation

#### Scenario: PDF notes are unavailable
- **WHEN** the More panel presents a disabled PDF-notes action
- **THEN** pressing it neither activates the action nor displays enabled press feedback

### Requirement: The Library subscription promotion is compact

The existing iOS non-subscriber promotion SHALL fit its icon, localized text, arrow, and padding instead of filling the sidebar. Its painted height SHALL be 36 logical points at the default text scale, with an 8-point gap from the arrow frame to the trailing painted edge. It SHALL remain vertically centered, retain a touch target of at least 44 points in height, and accommodate increased text size without clipping. Existing platform and subscription visibility rules SHALL remain unchanged.

#### Scenario: An eligible user opens the sidebar
- **WHEN** a non-subscribed iOS user opens the sidebar at default text scale
- **THEN** the promotion is 36 points high, sized to its contents, and has an 8-point trailing arrow inset
- **AND** tapping its accessible touch area opens the existing subscription route

#### Scenario: Text size increases
- **WHEN** the user increases the system text size
- **THEN** the promotion allows sufficient height for its localized content and preserves the arrow inset and touch target

### Requirement: Library list-picker labels match the title weight

All labels in the top Library list picker SHALL use the same medium weight as its header title, including selected and unselected Inbox, Starred, Archived, and available RSS choices. Selected indicators and selection behavior SHALL remain intact. Unrelated menus SHALL retain their current typography.

#### Scenario: The list picker opens
- **WHEN** the user taps the current list title
- **THEN** every offered list label has weight 500, matching the title
- **AND** selecting a choice switches the list and dismisses the picker as before

### Requirement: Library source items are vertically centered

Collection and RSS horizontal source strips SHALL vertically center each complete avatar-and-label group with equal space above and below the group. At default text scale their 96-point strip SHALL retain the 32-point avatar artwork inside its 38-point selection region, 4-point label gap, and 10-point names with 14-point label line height; item layout gaps SHALL be 22 points. Increased text scale SHALL remain legible without clipping. Existing selection, unread indicators, source availability, horizontal scrolling, and article scroll-position behavior SHALL remain intact.

#### Scenario: Collection or RSS sources are shown
- **WHEN** the Library displays its horizontal source strip at default text scale
- **THEN** each 56-point selection-region-and-label group has 20 points above and below it within the strip
- **AND** source selection and horizontal scrolling remain functional

#### Scenario: No Collections are subscribed
- **WHEN** the Library has no subscribed Collections
- **THEN** it continues to omit the Collection strip and its reserved height

### Requirement: Library header action icons have consistent visual treatment

The Library search and add-link icons SHALL have matching visual stroke weight and monochrome tone, comparable painted size, and aligned optical centers in their 24-point frames. Both controls SHALL retain at least 44-by-44-point touch targets and accessible action names. Shared search artwork SHALL remain coherent in its Search-screen placements.

#### Scenario: Header actions are displayed
- **WHEN** the Library header shows search and add-link actions
- **THEN** the two visible glyphs are vertically centered and have consistent stroke weight and tone
- **AND** their existing search and add-link actions remain reachable

### Requirement: Mobile code-assigned colors follow the approved palette

Reader text-selection styling SHALL use #FEEAC273 and annotation strokes SHALL use #CCB69AFF in HTML, PDF and comment-quote rendering. Search primary text SHALL use #333333 and secondary/placeholder text SHALL use #999999; Search submit text SHALL retain #16B998. Other code-assigned green colors SHALL use RGB #16B998 with existing alpha unchanged. Green embedded in imported image/icon artwork SHALL remain unchanged. Settings switch tracks SHALL use #16B998FF when on and #0F141914 when off.

#### Scenario: A selected passage is annotated and opened
- **WHEN** a user selects Reader text, adds an underline or comment, and opens its comment panel
- **THEN** the selected text uses the approved warm selection color and both document and quote strokes use the approved warm stroke color

#### Scenario: A code-assigned green is rendered
- **WHEN** an action, selection indicator, status, transcript timestamp or native share success indicator uses application-assigned green
- **THEN** its RGB is #16B998 with the previous alpha, while artwork's embedded colors are preserved

### Requirement: Reader feedback and tag input use the approved presentation

Reader copy and image-action notices SHALL be centered horizontally and vertically in their visible Reader or gallery surface without intercepting touches or changing their lifetime. The create-tag input SHALL use regular weight 400 while preserving tag creation, matching and validation behavior.

#### Scenario: A Reader action displays a notice
- **WHEN** copying text or completing an image action displays feedback
- **THEN** its notice is centered in the visible surface and retains its existing message and dismissal timing

### Requirement: Library picker motion is visible after presentation

The Library list picker SHALL enter with a short fade, subtle scale and vertical movement after its native modal is presented. Closing and rapid reversals SHALL cancel obsolete animations. Reduced motion SHALL suppress spatial movement and avoid delaying interaction. Other menu selection and dismissal behavior SHALL remain intact.

#### Scenario: Native modal presentation is delayed
- **WHEN** the native modal takes time to present the Library picker
- **THEN** the entrance animation starts after presentation instead of finishing while invisible

#### Scenario: The picker reverses or reduced motion is enabled
- **WHEN** the picker is rapidly closed/reopened or reduced motion is enabled
- **THEN** obsolete completion callbacks cannot hide the current picker, and reduced motion avoids spatial transitions

### Requirement: Acceptance refinements preserve compact edge-to-edge controls

The Library picker SHALL use 8-point vertical container padding. Search source, nested result, suggestion rows SHALL place horizontal gutters inside their pressable bounds, preserving content alignment while allowing presses and pressed paint to reach both edges of their surface. Outline morph and panel lower corners SHALL remain rounded throughout expansion, collapse and crossfade without changing transition timing or hit testing.

#### Scenario: Search rows are pressed at their edges
- **WHEN** a user presses a row within the side gutter of its surface
- **THEN** the same row action activates and its pressed paint covers the gutter

#### Scenario: The outline expands from its shortcut
- **WHEN** the shortcut morphs into the outline panel
- **THEN** its lower corners remain rounded throughout the transition

### Requirement: Mobile input presentation follows the approved form treatment

The Reader title editor SHALL use the Add URL compact dialog treatment, close button, outlined 8-point input and full-width confirmation while retaining controlled drafts, blank-title disabling and existing save behavior. Both search inputs SHALL use 8-point corner radii. Native Mobile inputs SHALL explicitly use #16B998 for the caret and input selection; Reader document selection SHALL retain its approved warm color.

#### Scenario: A title is edited
- **WHEN** the user opens the Reader title editor
- **THEN** the existing title draft appears in the Add URL-style form and can be saved or dismissed through its existing handlers

#### Scenario: A native input receives focus
- **WHEN** a Mobile native input is focused
- **THEN** its caret uses #16B998, including Search, tag filtering, comments, RSS, feedback and title/link fields

### Requirement: Search tags and supporting text follow Reader and Settings treatments

The Search tag picker SHALL present warm outlined wrapping chips in selected/available groups, with selected chips removable. Search selected-tag summaries SHALL use the Reader-header outlined chip treatment instead of a plain hashtag text string. Supporting search text SHALL use at least 14-point type and an appropriate 20-point line height, matching Settings descriptions; primary result titles retain their existing larger size.

#### Scenario: Tag selection completes
- **WHEN** selected tags are shown after dismissing the picker with Done
- **THEN** their names appear as separate outlined chips, with the existing manage/reset actions retained


### Requirement: Library source backgrounds cover native top overscroll

When the Collection or RSS source strip is present, Mobile SHALL paint #F5F5F3 upward from the strip by one measured list viewport height. This decoration SHALL not occupy layout space, receive input or accessibility focus, or change native scrolling, bounce, source selection and position restoration. Coverage SHALL update on viewport layout changes rather than scroll events. Other list backgrounds SHALL remain unchanged.

#### Scenario: Pulling down a source list
- **WHEN** the user pulls the list down from its top
- **THEN** the exposed area above the source strip retains #F5F5F3 while native bounce remains active

#### Scenario: The viewport changes size
- **WHEN** rotation or another layout change changes the list viewport height
- **THEN** upward coverage matches the new viewport without adding header height or resetting the list


### Requirement: Search refinement preserves aligned compact controls

The Search keyword input SHALL use 15-point type for text and placeholder. The tag-toggle chevron's painted shape SHALL be vertically centered with its 14/20 label while retaining its existing frame, pressable area and selection behavior.

#### Scenario: Opening Search without text
- **WHEN** the keyword field is empty
- **THEN** its placeholder uses 15-point type and the tag toggle keeps its label and painted chevron vertically aligned

### Requirement: Library source widths adapt without selection movement

Collection and RSS source items SHALL use intrinsic name widths with a minimum item width of 38 logical points, single-line name widths capped at 72 points and 22-point gaps between item layout bounds on iOS and Android. Existing 32-point avatars, 10/14 typography, 4-point avatar-to-label gaps, middle truncation and selected/unselected weights SHALL remain intact. Selecting a source SHALL NOT resize the item or move neighbouring items. Horizontal scrolling and source selection SHALL remain functional.

#### Scenario: Sources have short and long names
- **WHEN** the source strip contains short, medium and long source names
- **THEN** short-name items occupy at least 38 points, longer items grow to the name width up to 72 points, and overflowing names truncate
- **AND** neighbouring item bounds are separated by 22 points

#### Scenario: Selection changes or text size increases
- **WHEN** the user selects another source or increases system text size
- **THEN** selection changes the current label weight without moving items, and scaled names retain the 72-point cap
- **AND** source avatars, native horizontal scrolling and article selection behavior remain intact
