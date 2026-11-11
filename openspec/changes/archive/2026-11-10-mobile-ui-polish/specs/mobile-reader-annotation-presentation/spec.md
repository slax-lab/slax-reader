## ADDED Requirements

### Requirement: Reader selection uses the confirmed green hue

Mobile HTML and PDF readers SHALL use RGBA `#8AD8A866` for CSS text-selection backgrounds and its matching opaque green for caret styling. The iOS Reader WKWebView SHALL explicitly set its native tint to the same opaque green, rather than relying only on document CSS or the inherited system tint. Native iOS selection SHALL retain platform handles and system-controlled opacity, as accepted by the owner. The change SHALL NOT replace selection tracking, modify persisted annotations, or change Web and Extension styling.

#### Scenario: Text is selected in the Reader
- **WHEN** the user selects HTML or PDF text on a supported Mobile platform
- **THEN** the selection uses the confirmed green hue
- **AND** CSS-rendered selection retains 40% opacity while native iOS selection retains its system-controlled opacity
- **AND** selection dragging, copying, highlighting, and commenting retain their existing behavior

### Requirement: Comment-quote decoration clears the text

The comment panel SHALL place each visible quote underline below the measured line box with two logical points of clearance, rather than using a baseline-relative text underline. Quote lines SHALL use the same `#F6AF69` mark-stroke color as the article. Comment-only quotes SHALL use dashed decoration; quotes with a stroke SHALL use solid decoration; unmarked draft quotes SHALL have no decoration. The quote SHALL retain its two-line tail ellipsis, complete copy payload, font scaling, and original accessibility text. Decoration SHALL NOT receive touches or independent accessibility focus.

#### Scenario: A comment quote wraps or changes layout
- **WHEN** a quote wraps, is truncated to two lines, changes width or font scale, or uses right-to-left text
- **THEN** only its visible lines receive decoration positioned from the native line measurements
- **AND** each decoration follows its line's horizontal position and width while remaining below the text

#### Scenario: The user opens a different quote or changes annotation state
- **WHEN** the displayed quote changes or its stroke/comment state changes
- **THEN** the panel renders the current quote with its appropriate decoration without retaining old quote measurements
- **AND** copy, highlight, reply, send, and comment-menu actions continue to work
