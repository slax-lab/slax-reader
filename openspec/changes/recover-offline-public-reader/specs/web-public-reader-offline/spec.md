## Purpose

Keep the last successfully viewed public article title and its complete readable text on this browser or WebView. Make the same URL readable across a fully offline reload and distinguish the saved copy from live content.

## ADDED Requirements

### Requirement: Read previously opened public articles in full while offline

The Web experience SHALL keep the last successfully viewed public article title and its complete readable text on this browser or WebView. Make the same URL readable across a fully offline reload and distinguish the saved copy from live content.

#### Scenario: Offline full-text reopen

- **WHEN** a reader reaches the end of a public HTML article online and later reopens exactly that URL offline in the same browser storage
- **THEN** the title and full readable text through the last paragraph appear with an offline indication and a way to retry

#### Scenario: Private or unavailable content

- **WHEN** a reader navigates offline to an unvisited URL or an article previously accessible only as its owner
- **THEN** an unavailable message appears and no private body, session information or account annotations are exposed

#### Scenario: Freshness and revocation

- **WHEN** the browser reconnects and opens a previously cached URL that has changed or is explicitly no longer public
- **THEN** a successful live read refreshes the saved text and a definitive denial removes the obsolete copy so the next offline visit cannot display it
