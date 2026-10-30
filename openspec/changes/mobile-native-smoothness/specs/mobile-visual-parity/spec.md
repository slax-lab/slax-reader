## MODIFIED Requirements

### Requirement: Mobile motion remains native-coupled and interruptible

The approved architecture follow-up SHALL use existing native/UI-thread mechanisms for gesture and scroll-following motion, without per-frame React state updates or rebuilding PDF layout. Reusable motion parameters/policies SHALL preserve measured interruptible entry/exit, reduced motion, accessibility visibility, hit testing, stationary backdrops, keyboard avoidance, native-back cancellation and real dismissal completion. Drawer, row swipe, Reader floating actions, sheets/comment keyboard and route transitions SHALL be verified on both native platforms; unit tests alone MUST NOT establish smoothness or unmeasured frame-rate improvements.

The Library drawer SHALL be driven by a single pan gesture whose position, scrim visibility and content/scrim hit testing are owned on the UI thread. While closed it SHALL activate only from the leading screen edge with directional activation and failure offsets, so vertical list scrolling never waits on it. It SHALL publish every resolved open or close result independently of animation completion. It SHALL NOT toggle the covered list's scroll capability, reset its scroll offset, or propagate an input lock into list rows. A gesture that interrupts the first close, or a superseded animation completion, MUST NOT leave the full-screen dismiss surface intercepting touches or prevent a later opening gesture.

Library row swipe actions SHALL use directional activation and vertical failure offsets on the UI thread, settle with release velocity, and communicate with JavaScript only for haptics and the final action. Library and RSS feeds SHALL sample scroll position at a bounded rate (no per-frame JavaScript work), SHALL keep their visible-position policy constant during scrolling (switching the content set — an RSS source or a Library list — suspends it until the replacement rows render, so a switch never plays a scroll-to-top animation or anchors to a row of the previous set), SHALL report fixed-height row layout including separators so virtualization spacers match rendered rows, and SHALL NOT apply background row updates while the user is scrolling; the latest update is applied once scrolling settles. On iOS exactly one visible feed SHALL respond to the status-bar scroll-to-top gesture.

#### Scenario: A sheet or gesture animation is interrupted
- **WHEN** dismissal, replacement, backgrounding or native-back cancellation interrupts motion
- **THEN** the owning animation stops or resumes coherently without stale callbacks, hidden touch interception or lost drafts
- **AND** reduced-motion and accessibility state match the final visible/native navigation state

#### Scenario: Another gesture interrupts the first drawer close
- **WHEN** the user closes the Library drawer and begins another gesture before the close result reaches the screen
- **THEN** the drawer still settles closed and the library remains scrollable and tappable
- **AND** the dismiss surface no longer intercepts touches
- **AND** a later edge swipe or menu press still opens the drawer

#### Scenario: The drawer opens during a list fling
- **WHEN** the user opens the drawer from the leading edge while the Library list is decelerating
- **THEN** the list is not programmatically scrolled or jumped to an earlier offset
- **AND** the drawer follows the finger without waiting for list or row gestures to fail

#### Scenario: The user scrolls vertically starting on a row
- **WHEN** a touch on a Library row moves predominantly vertically
- **THEN** native scrolling begins after the platform touch slop without waiting for drawer arbitration
- **AND** no row swipe or drawer motion starts

#### Scenario: Background updates arrive during a fling
- **WHEN** synchronization or offline caching publishes changed Library rows while the list is being dragged or decelerating
- **THEN** the visible rows do not change or shift until the list comes to rest
- **AND** the latest rows are applied once, without reapplying an update from a replaced account scope

#### Scenario: The user switches RSS source
- **WHEN** the user selects another RSS source or All while the feed is at or near the top
- **THEN** the new source appears at the top immediately, without an animated scroll
- **AND** the source rail keeps its horizontal position

#### Scenario: The user taps the iOS status bar
- **WHEN** the Library feed is visible and the drawer is closed
- **THEN** the feed scrolls to the top using the native scroll-to-top behavior

#### Scenario: PDF uses the approved uncluttered Reader presentation
- **WHEN** a PDF is opened or scrolled
- **THEN** its native header/widgets and document move through the established HTML Reader scroll model without a separate capped header scroller
- **AND** AI-preparation notices, offline/completion badges, partial-cache rows and PDF page/zoom/Fit toolbar are absent while existing native Reader actions and genuine error feedback remain
