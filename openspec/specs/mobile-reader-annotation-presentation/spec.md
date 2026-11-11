# mobile-reader-annotation-presentation Specification

## Purpose
Give Mobile Reader selection and comment quotes the approved selection and annotation palette with clear quote decoration, without changing selection tracking, persisted annotations, or Web and Extension styling.

## Requirements

### Requirement: Reader selection uses the approved selection color

Mobile HTML and PDF readers SHALL use RGBA `#FEEAC273` for CSS text-selection backgrounds and its matching opaque `#FEEAC2` for caret styling. The iOS Reader WKWebView SHALL explicitly set its native tint to the same opaque color, rather than relying only on document CSS or the inherited system tint. Native iOS selection SHALL retain platform handles and system-controlled opacity, as accepted by the owner. Selection tracking, persisted annotations, and Web and Extension styling SHALL remain unchanged.

#### Scenario: Text is selected in the Reader
- **WHEN** the user selects HTML or PDF text on a supported Mobile platform
- **THEN** the selection uses the approved selection color
- **AND** CSS-rendered selection retains its approved alpha while native iOS selection retains its system-controlled opacity
- **AND** selection dragging, copying, highlighting, and commenting retain their existing behavior

### Requirement: Comment-quote decoration clears the text

The comment panel SHALL place each visible quote underline below the measured line box with two logical points of clearance, rather than using a baseline-relative text underline. Quote lines SHALL use the same `#CCB69AFF` mark-stroke color as the article. Comment-only quotes SHALL use dashed decoration; quotes with a stroke SHALL use solid decoration; unmarked draft quotes SHALL have no decoration. The quote SHALL retain its two-line tail ellipsis, complete copy payload, font scaling, and original accessibility text. Decoration SHALL NOT receive touches or independent accessibility focus.

#### Scenario: A comment quote wraps or changes layout
- **WHEN** a quote wraps, is truncated to two lines, changes width or font scale, or uses right-to-left text
- **THEN** only its visible lines receive decoration positioned from the native line measurements
- **AND** each decoration follows its line's horizontal position and width while remaining below the text

#### Scenario: The user opens a different quote or changes annotation state
- **WHEN** the displayed quote changes or its stroke/comment state changes
- **THEN** the panel renders the current quote with its appropriate decoration without retaining old quote measurements
- **AND** copy, highlight, reply, send, and comment-menu actions continue to work
