# Mobile Adaptive PDF Reading

## Purpose

Prototype adjacent-page PDF reading on supported adaptive displays while retaining document state, annotation geometry and the established single-page experience elsewhere.

## ADDED Requirements

### Requirement: Dual-page reading is an explicit adaptive prototype

The prototype SHALL be opt-in and SHALL present adjacent PDF pages when supported scene geometry provides enough usable space. Folding, resizing and safe-area changes SHALL recompute layout from current measured bounds. Unsupported OS versions, narrow windows and a disabled prototype SHALL use the existing single-page Reader. Hinge pose alone MUST NOT determine whether a two-page layout fits.

#### Scenario: A wide scene becomes narrow
- **WHEN** a dual-page PDF scene is folded, resized or otherwise loses usable width
- **THEN** it returns to single-page presentation without overlapping pages or obscured controls
- **AND** the current document position remains recoverable

#### Scenario: The prototype is unavailable or disabled
- **WHEN** the app runs on an unsupported system or the prototype is not enabled
- **THEN** ordinary PDF reading retains its existing layout and controls
- **AND** unavailable native APIs do not prevent startup or reading

### Requirement: Adaptive application surfaces respect the current scene safe area

The Inbox toolbar and feed, navigation drawer, Reader content and anchored menus SHALL consume the current scene's measured safe bounds on every edge. A lateral system area MUST NOT be treated as a top inset or replaced with device-specific padding. Fold, resize and orientation changes SHALL update those bounds without remounting the reading session. Drawer and menu content SHALL remain reachable when the current usable scene height decreases.

#### Scenario: An unfolded scene reserves space along its right edge
- **WHEN** the native scene reports a right safe-area inset with a zero top inset
- **THEN** Inbox and Reader content avoid the reserved right-side system area
- **AND** anchored menus remain within their own presentation surface's safe bounds

#### Scenario: The drawer remains open during a posture change
- **WHEN** a posture or window change reduces the available drawer height
- **THEN** all drawer actions remain reachable by scrolling
- **AND** its controls respect the updated scene safe area

### Requirement: Layout changes preserve page-based reading state

Single-page and spread layouts SHALL share one document identity and reading session. Progress and restoration SHALL retain the first visible document page and normalized position across layout changes, navigation and cold relaunch. An odd final page SHALL remain readable without generating a nonexistent page or changing persisted document identity.

#### Scenario: A restored page moves into a spread
- **WHEN** a user reopens a PDF at its saved page and the scene supports two pages
- **THEN** the spread contains that page and preserves its reading position
- **AND** shrinking back to one page does not reset the document to the beginning

### Requirement: Selection and annotations retain document coordinates

Selections, highlights, comment anchors and hit testing SHALL remain associated with the correct PDF page and document coordinates after resizing or spread changes. Accessibility reading order SHALL follow document page order, and reduced-motion preferences SHALL be honored.

#### Scenario: A marked page moves to the other pane
- **WHEN** an existing highlight or comment page changes pane after resizing or navigation
- **THEN** its rendering and hit target remain attached to the same page coordinates
- **AND** assistive reading and selection do not jump to the adjacent page

### Requirement: Spreads retain bounded offline resource ownership

The prototype SHALL reuse existing authenticated PDF acquisition, integrity checks, cache policy and per-document cancellation. It SHALL keep rendering/acquisition bounded to the active viewport neighborhood rather than create independent unbounded readers per pane. Account/document replacement SHALL revoke obsolete resource access.

#### Scenario: A cached PDF is read offline in two-page mode
- **WHEN** an admitted complete cached PDF opens offline in a supported scene
- **THEN** both visible pages render from the existing validated cache
- **AND** closing or replacing the document cancels old work without deleting pending user data
