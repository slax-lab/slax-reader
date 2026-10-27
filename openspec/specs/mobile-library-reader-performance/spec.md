# mobile-library-reader-performance Specification

## Purpose
Keeps background Library work, reader header configuration and feed scroll observation from competing with foreground reading, scrolling and toolbar motion on mobile.

## Requirements

### Requirement: Hidden Library suspends list queries

The Library SHALL NOT keep its bookmark or collection-bookmark list queries subscribed while another route covers it or the application is not active. While suspended, the Library SHALL keep its last published rows and SHALL NOT show a loading or empty state because of the suspension. When the Library becomes visible and the application is active again, it SHALL resubscribe once and publish current rows.

#### Scenario: Background writes while reading
- **WHEN** a reader covers the Library and local bookmark data changes (for example reading progress or cache state)
- **THEN** the Library does not re-run its bookmark or collection-bookmark list query

#### Scenario: Returning to the Library
- **WHEN** the user returns from the reader to the Library
- **THEN** the previously shown rows remain visible without a loading or empty flash
- **AND** the Library resubscribes once and shows the current rows when the query result arrives

#### Scenario: Application backgrounded on the Library
- **WHEN** the application leaves the active state while the Library is visible
- **THEN** the list queries are suspended and resume once when the application becomes active again

### Requirement: Reader header configuration is stable across toolbar changes

The reader SHALL configure its native navigation header actions once per reader presentation and SHALL NOT reconfigure them when toolbar visibility changes. The header More action SHALL still follow toolbar visibility: when the toolbar is hidden it SHALL NOT receive touches and SHALL be hidden from assistive technologies, and when the toolbar is shown it SHALL be interactive and accessible.

#### Scenario: Scrolling hides and shows the toolbar
- **WHEN** reader scrolling hides and then shows the toolbar
- **THEN** the navigation header options are not reconfigured
- **AND** the More action stops receiving touches and is hidden from assistive technologies while hidden, and becomes interactive and accessible again when shown

#### Scenario: A header element is created after a toolbar change
- **WHEN** the navigation header renders its More action after the toolbar has been hidden
- **THEN** the action reflects the current hidden state

### Requirement: Feed scroll observation is bounded with exact settled offsets

Library and RSS feeds SHALL receive scroll position samples below display rate while scrolling. When a drag or fling ends, the feed SHALL record the exact settled offset, clamped to the scrollable range. A settled-offset observation SHALL NOT overwrite a saved position that is still pending restoration.

#### Scenario: A fling settles
- **WHEN** the user flings a feed and the momentum ends
- **THEN** the remembered offset equals the settled offset, clamped to the scrollable range

#### Scenario: Restoring a saved position
- **WHEN** a feed remounts with a saved offset and the native list reports a provisional zero offset at rest
- **THEN** the saved offset is kept until restoration completes
