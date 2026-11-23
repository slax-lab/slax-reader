## Purpose

Give readers consistent inbox, subscription, and Feed presentation and navigation in Reader Web.

## ADDED Requirements

### Requirement: Subscribed avatar unread indicator

Reader Web SHALL show a circular 6px colored unread indicator at the top right of each subscribed avatar with unread content. Any surrounding separation ring SHALL sit outside the 6px color area.

#### Scenario: Read and unread subscriptions are shown together

- **WHEN** the avatar strip contains a read subscription and one with unread content
- **THEN** the unread subscription shows a 6px colored dot and the read subscription shows no dot

### Requirement: Personal inbox toolbar with subscribed avatars

When My Inbox is selected and subscribed avatars are visible, Reader Web SHALL center visible desktop list-mode controls vertically against the avatars and display the existing update timestamp below the avatar row with less space before the list than in the previous layout. It SHALL preserve the existing rules for showing the timestamp, list-mode controls, and source-filter removal.

#### Scenario: Return to My Inbox from a subscription

- **WHEN** a reader with subscriptions returns to a populated My Inbox at a desktop width
- **THEN** the list-mode icons share the avatar row's vertical center and the timestamp sits below with more breathing room above and closer to the first date group or item

#### Scenario: A source filter is active

- **WHEN** a source filter is active in My Inbox
- **THEN** the source-filter label and clear action remain usable, including at widths where the mode controls are hidden

#### Scenario: No avatar strip

- **WHEN** there are no subscriptions or the reader is on another list surface
- **THEN** that surface keeps its existing toolbar layout

### Requirement: Subscribed entry metadata dividers

A subscribed collection's entry metadata SHALL use centered 12px vertical dividers matching the personal text list. Every divider SHALL separate two visible metadata fields.

#### Scenario: Entry metadata fields vary

- **WHEN** a subscribed entry shows any combination of date, highlight count, and source
- **THEN** a short vertical divider appears only between adjacent visible fields, with no divider before the first field

### Requirement: Feed source names fit their tiles

Reader Web SHALL give fallback text inside Feed source avatars and the labels below them enough line height to show descenders and diacritics. Long names SHALL truncate only horizontally and keep the full accessible name on the source button.

#### Scenario: A long source name includes descending letters

- **WHEN** a source without an image displays a fallback word and a long label
- **THEN** both text lines retain their vertical glyphs and use an ellipsis when their width is insufficient

### Requirement: Newsletter setup disclosure motion

Reader Web SHALL transition height and opacity when Newsletter setup details expand or collapse. The collapsed summary SHALL transition where applicable. The issued address and Copy action SHALL remain visible. Hidden details SHALL be inert. E-ink and reduced motion SHALL switch states immediately.

#### Scenario: An issued address remains accessible during disclosure

- **WHEN** a user collapses or expands an issued Newsletter address card
- **THEN** the card changes height smoothly and the details fade out or in while the address and Copy action stay available

#### Scenario: A reader prefers less motion

- **WHEN** a user toggles the disclosure in e-ink or with reduced motion
- **THEN** the new state appears immediately and the hidden content leaves keyboard navigation

### Requirement: Feed tab query

When a reader selects Feed, Reader Web SHALL set `view=rss` and remove bookmark-only tab, tag, collection, and search parameters while keeping unrelated query parameters. Reader Web SHALL continue opening existing Feed links with legacy bookmark parameters and SHALL navigate to the requested bookmark tab when leaving Feed.

#### Scenario: Enter Feed from a filtered bookmark list

- **WHEN** a reader selects Feed while the address contains a bookmark filter and unrelated parameters
- **THEN** Feed opens with `view=rss` and the unrelated parameters, with the bookmark filters removed

#### Scenario: Open an older Feed link

- **WHEN** a reader opens a link containing both `view=rss` and an Inbox or tag filter
- **THEN** Feed opens and remains active, and selecting a bookmark tab opens that tab
