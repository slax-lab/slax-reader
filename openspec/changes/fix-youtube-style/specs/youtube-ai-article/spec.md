## ADDED Requirements

### Requirement: Edited article typography is isolated from generic content resets

The Web reader SHALL retain the dedicated edited-YouTube-article typography, alignment, and vertical rhythm when the complete application stylesheet is loaded. Paragraphs SHALL retain the existing 18px sans-serif reading size and 1.85 line-height ratio through nested sections. Contents labels SHALL retain their compact 14px sans-serif presentation and start alignment rather than justified text. Topic headings, paragraphs, introduction labels, timestamps, and method notes SHALL retain the dedicated hierarchy and spacing rather than generic article defaults.

#### Scenario: Saved edited article renders inside the normal reader
- **WHEN** a reader opens a bookmark whose saved body contains an edited YouTube article
- **THEN** nested paragraphs render at the dedicated reading line height, with zero top margin and the existing bottom spacing
- **AND** contents labels do not acquire generic serif typography, enlarged body text, or stretched justification spaces
- **AND** chapter spacing follows the dedicated reading rhythm rather than generic first-child and paragraph spacing rules

#### Scenario: Separate edited article renders below an annotated transcript
- **WHEN** existing marks require the generated article to render separately below the original transcript
- **THEN** its corresponding reading elements retain the same typography roles and rhythm as the saved-body presentation
- **AND** neither presentation depends on a preferred font being installed to avoid clipping or overlap

#### Scenario: Supported themes and widths
- **WHEN** the edited article is displayed in light, dark, or e-ink at narrow and desktop widths
- **THEN** paragraphs and contents wrap without clipping, overlap, or horizontal document overflow
- **AND** contents links and seek controls retain visible keyboard focus and their existing target sizes

### Requirement: Edited article seeking uses chapter controls without paragraph indicators

Both edited YouTube body presentations SHALL show a 12px accent-colored seek button beside each timed chapter heading, using `m:ss` or `h:mm:ss` labels and the existing `slax:youtube-seek` event bridge. Saved-body controls SHALL derive their time from the existing heading's `data-start-ms`. Paragraph timestamp nodes SHALL remain in the saved DOM but SHALL be invisible and excluded from keyboard focus and accessibility output. Paragraphs SHALL NOT acquire playback backgrounds, accent edges, or follow-along scrolling in this presentation.

#### Scenario: Reader seeks to a chapter
- **WHEN** a reader clicks a chapter control or activates it with Enter or Space
- **THEN** exactly one YouTube seek event carries the chapter start in whole seconds
- **AND** the control provides visible focus and a target at least 44px wide and tall
- **AND** the expanded component's existing native chapter control continues to work

#### Scenario: Saved article is processed repeatedly and removed
- **WHEN** the processor runs repeatedly on the same live body
- **THEN** there is exactly one added control per timed heading and no duplicate listeners
- **WHEN** the processor is cleaned up
- **THEN** its controls and listeners are removed and paragraph timestamp visibility/focus attributes are restored
- **AND** processing the body again installs one working set of controls

#### Scenario: Video playback advances through paragraphs
- **WHEN** playback time updates occur while an edited YouTube body is displayed
- **THEN** paragraphs remain visually quiet with no playback background or left edge
- **AND** hidden paragraph timestamps cannot be reached by keyboard and do not trigger paragraph-follow scrolling

### Requirement: Edited article styling has no unrelated presentation effects

The correction SHALL affect only the edited YouTube article body. It SHALL preserve existing paragraph elements, descendant text nodes, heading text nodes and IDs, annotation selectors, and contents navigation. Adding chapter-control nodes and reversible timestamp visibility attributes is permitted; moving or replacing existing content is not. Ordinary articles, raw YouTube transcripts, podcast articles, the player (including its maximum width), the sidebar, and the application shell SHALL retain their existing behavior and presentation.

#### Scenario: Existing article interaction
- **WHEN** a reader uses contents links, chapter controls, or existing annotations after the correction
- **THEN** contents anchors, text ranges, paragraph identities, and stored annotation targets remain valid
- **AND** chapter seeking works without rewriting saved HTML or regenerating content

#### Scenario: Another content type is displayed
- **WHEN** a reader opens an ordinary article, raw-caption body, or podcast article
- **THEN** the edited-YouTube correction does not change that content's computed typography, spacing, controls, or playback behavior
