# Spec Delta

## MODIFIED Requirements

### Requirement: Mobile motion remains native-coupled and interruptible

The approved architecture follow-up SHALL use existing native/UI-thread mechanisms for gesture and scroll-following motion, without per-frame React state updates or rebuilding PDF layout. Reusable motion parameters/policies SHALL preserve measured interruptible entry/exit, reduced motion, accessibility visibility, hit testing, stationary backdrops, keyboard avoidance, native-back cancellation and real dismissal completion. Drawer, row swipe, Reader floating actions, sheets/comment keyboard and route transitions SHALL be verified on both native platforms; unit tests alone MUST NOT establish smoothness or unmeasured frame-rate improvements.

The Library drawer SHALL publish every resolved open or close result independently of animation completion, and the content touch owner, dismiss-surface touch owner and feed input lock SHALL be derived from the drawer that is actually on screen. A gesture that interrupts the first close, or a superseded animation completion, MUST NOT leave the full-screen dismiss surface intercepting touches, leave the feed input-locked, or prevent a later opening gesture.

#### Scenario: A sheet or gesture animation is interrupted
- **WHEN** dismissal, replacement, backgrounding or native-back cancellation interrupts motion
- **THEN** the owning animation stops or resumes coherently without stale callbacks, hidden touch interception or lost drafts
- **AND** reduced-motion and accessibility state match the final visible/native navigation state

#### Scenario: Another gesture interrupts the first drawer close
- **WHEN** the user closes the Library drawer and begins another gesture before the close result reaches the screen
- **THEN** the drawer still settles closed and the library remains scrollable and tappable
- **AND** the dismiss surface no longer intercepts touches
- **AND** a later edge swipe or menu press still opens the drawer

#### Scenario: PDF uses the approved uncluttered Reader presentation
- **WHEN** a PDF is opened or scrolled
- **THEN** its native header/widgets and document move through the established HTML Reader scroll model without a separate capped header scroller
- **AND** AI-preparation notices, offline/completion badges, partial-cache rows and PDF page/zoom/Fit toolbar are absent while existing native Reader actions and genuine error feedback remain
