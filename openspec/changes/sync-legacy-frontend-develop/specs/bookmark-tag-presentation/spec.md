# Spec Delta

## Purpose

Present bookmark tags consistently for topic filters, bookmark list layouts, and article details while preserving existing editing and selection behavior.

## ADDED Requirements

### Requirement: Tags have context-specific presentation

The Web app SHALL use distinct topic, card-list, text-list, and article-detail tag presentations. Article-detail styles SHALL remain independent of list and topic styles. Card-list hover and focus SHALL change text emphasis without changing the chip border or background. Text-list tags SHALL retain their separating dividers.

#### Scenario: Switching list layout

- **WHEN** a user switches between card and text list layouts
- **THEN** tags use the presentation and action geometry appropriate to the selected layout
- **AND** tag selection and removal continue to operate on the same bookmark and tag

#### Scenario: Reading article tags

- **WHEN** tags are displayed in an article detail view
- **THEN** they use the dedicated detail presentation with truncated long names and a removal affordance when editable

### Requirement: Tag actions remain accessible and respect permissions

Editable tags SHALL expose their applicable actions on pointer hover and keyboard focus, provide accessible action names, and preserve existing permission checks. Read-only tags MUST NOT expose removal controls. Topic actions SHALL have reserved space that does not overlap their text.

#### Scenario: Keyboard access to removal

- **WHEN** keyboard focus enters an editable tag's removal action
- **THEN** the action is visible with a focus indicator and can remove that tag without selecting it

#### Scenario: Read-only article

- **WHEN** a user views tags without edit permission
- **THEN** tag removal controls are absent

### Requirement: Compact tags preserve overflow controls

Compact bookmark tags SHALL reserve room for the context-specific add or overflow control and action expansion. Visible tags and their measurement representation SHALL use the same presentation. Tags that do not fit SHALL remain reachable through the overflow interaction.

#### Scenario: Narrow bookmark row

- **WHEN** a bookmark row becomes too narrow for all of its tags
- **THEN** the fitting tags remain visible and the overflow control remains reachable without clipping

### Requirement: Tag presentation follows Web themes

Changed tag surfaces SHALL use the Web semantic theme roles in light, dark, and e-ink modes and honor the existing reduced-motion and e-ink effect suppression rules.

#### Scenario: Theme changes

- **WHEN** a user switches between light, dark, and e-ink
- **THEN** tag labels, dividers, action controls, and focus states remain legible in the selected theme
