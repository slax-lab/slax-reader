# outline-anchor-navigation

## Purpose

Lets users jump from a numbered anchor in the Outline panel to the matching passage in the article body on the web reader, with a temporary flash highlight that never disturbs article layout.

## Requirements

### Requirement: Anchor navigation scrolls to and flashes the matched passage

The web reader SHALL scroll the matched passage into view and apply a temporary flash highlight to the matched text when the user clicks a numbered anchor in the Outline panel, and SHALL remove the highlight automatically after a short interval.

#### Scenario: Anchor match in regular prose

- **WHEN** the user clicks a numbered anchor whose matched passage lies in regular prose
- **THEN** the reader scrolls the passage into view and flashes the matched text, and the highlight disappears after the interval with the surrounding text unchanged

### Requirement: Flash highlighting preserves table layout

The flash highlight MUST NOT insert any element into a table at positions where table structure forbids non-table content; highlighting inside a table SHALL be limited to text within cells. Whitespace-only text nodes MUST NOT be wrapped by the highlight.

#### Scenario: Anchor match spans a table

- **WHEN** the user clicks a numbered anchor whose matched passage falls inside or spans a table
- **THEN** only text inside table cells is highlighted, no element is inserted between table-structure siblings (rows, sections, columns), and the table's columns and rows render exactly as before the click

#### Scenario: Highlight is removed after the interval

- **WHEN** the flash interval elapses after a table-spanning match was highlighted
- **THEN** all highlight elements are removed and the table renders identically to its state before the click

### Requirement: Anchor matching is scoped to the article body

Anchor text matching SHALL search only within the article body container of the current reading page and MUST NOT fall back to matching against the whole document.

#### Scenario: Anchor text also appears outside the article

- **WHEN** the anchor's reference text appears in a panel or elsewhere outside the article body but not inside the article
- **THEN** no navigation or highlight is triggered from the out-of-article occurrence
