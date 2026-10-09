# Spec Delta

## Purpose

Keep article tables readable across viewport sizes without changing the document structure used by saved highlights, comments, and outline navigation.

## ADDED Requirements

### Requirement: Tables fit or scroll inside the article

An article table SHALL fill the available article width when its content fits. When its content cannot fit, the table SHALL allow horizontal scrolling within the article instead of clipping content or widening the page. This behavior SHALL update after viewport resizing or late content growth.

#### Scenario: Short table on mobile

- **WHEN** table content fits within a narrow article viewport
- **THEN** columns use native table layout and the table fills the available article width

#### Scenario: Wide table on mobile

- **WHEN** table content exceeds the available article width
- **THEN** the full content is reachable through horizontal scrolling and the page does not overflow horizontally

#### Scenario: Content grows after initial rendering

- **WHEN** an image or font changes the required table width after initial rendering
- **THEN** the table transitions between fitting and scrolling behavior as appropriate

### Requirement: Responsive table layout preserves annotations

Responsive sizing MUST NOT wrap or relocate table elements in a way that changes the selectors used by saved annotations. Existing highlights, comments, and outline anchor navigation SHALL continue to work, and scrolling tables SHALL retain their horizontal offset while remaining in scrolling mode.

#### Scenario: Annotated table is resized

- **WHEN** a table with existing saved annotations changes between fitting and scrolling layouts
- **THEN** annotations still refer to the original content and its table hierarchy is preserved

#### Scenario: Outline navigation enters a table

- **WHEN** the user navigates to a table passage from the outline
- **THEN** the existing flash highlight does not disturb table rows or columns
