## ADDED Requirements

### Requirement: Hide empty layout tables without removing content
Article table processing SHALL hide tables containing only whitespace and no media. It SHALL preserve tables containing text, native media or the Article pipeline's media player elements. Hiding SHALL retain the original DOM nodes and annotation paths. Newsletter Feed previews SHALL reuse the same table layout processing without changing RSS-specific rendering.

#### Scenario: Empty spacer table
- **WHEN** an Article or Newsletter contains a whitespace-only table, including nested empty tables
- **THEN** the table is hidden without deleting or relocating it or its descendants

#### Scenario: Media without text
- **WHEN** a table contains an image, video, audio or an Article media player but no text
- **THEN** the table remains visible and responsive table layout still applies
