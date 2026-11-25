# Reader appearance preferences

## Purpose

Let people adapt the appearance of HTML article prose to their reading needs on Web and Mobile without changing the article or the surrounding application.

## ADDED Requirements

### Requirement: Readers can adjust appearance from an open HTML article
Web and Mobile SHALL offer labeled controls for page background, body text color, size, and typeface in the article reader. Each control SHALL indicate the selected value without relying only on color. Changes SHALL take effect on the open article without a reload or separate save step.

#### Scenario: Change paper, ink, size and typeface independently
- **WHEN** a reader opens appearance settings on desktop Web, narrow Web, iOS or Android
- **THEN** they can choose default, light, warm paper or dark backgrounds; automatic or named compatible ink colors; smaller, default or larger body text; and default, serif or sans-serif type
- **AND** choosing one setting leaves the other selections unchanged.

#### Scenario: Choose colors with readable contrast
- **WHEN** a user chooses a paper color with automatic ink
- **THEN** the article uses a readable ink for that paper, and every paper choice is reachable in this mode
- **AND** with explicit ink, a conflicting paper or ink choice is identified as unavailable with an explanation, without discarding the current choice.

### Requirement: Appearance is a local preference with a reversible default
The reader SHALL remember appearance across articles and client restarts in the current local preference scope. Reset SHALL restore all four defaults without changing other preferences. Defaults SHALL retain the client's existing reader treatment.

#### Scenario: Open a second article and restart
- **WHEN** a user selects warm paper and larger serif text, then opens another HTML article or restarts the same client
- **THEN** the new article and controls reflect those choices, including a cached article already available offline.

#### Scenario: Restore defaults
- **WHEN** a user resets appearance on an open article
- **THEN** the article and controls return to the current Web theme's reader defaults or Mobile's original reader treatment
- **AND** the reset persists after reopening; unrelated preferences and marks do not change.

### Requirement: Personal styling preserves reading context and content boundaries
The settings SHALL apply to the reading surface and prose in personal and shared HTML articles, including public Web prose, without changing the published article or other readers' views. Reflow SHALL keep the current passage in view and existing annotations attached to the same text. The application shell, images, third-party frames and fixed-layout PDF pages SHALL retain their own presentation.

#### Scenario: Reflow a marked passage
- **WHEN** a reader changes size or typeface halfway through an article containing a marked paragraph, a link and a code sample
- **THEN** the same passage stays in view and the mark still selects the same excerpt
- **AND** the link remains distinguishable and usable, code remains monospaced, and text selection remains usable.

#### Scenario: Leave the article or open a PDF
- **WHEN** a reader with custom appearance opens the library or a fixed-layout PDF
- **THEN** library chrome and PDF pages retain their original appearance, and PDF readers do not offer ineffective HTML styling controls.
