# bookmark-tag-presentation Specification

## Purpose
Present bookmark tags consistently for topic filters, bookmark list layouts, and article details while preserving existing editing and selection behavior.

## Requirements

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

### Requirement: Editable bookmark tags use the available transport

Editable bookmark tags SHALL use an available local writer for local-first operations. When local database startup is unavailable and the displayed bookmark has a REST-compatible identity, adding existing tags, creating and attaching new tags, and removing associations SHALL use the existing REST APIs even when a local-first adapter is injected. Merely having an adapter SHALL NOT block the REST path. This behavior SHALL cover compact bookmark rows and editable non-compact tag surfaces without altering permission checks.

#### Scenario: Adapter exists but database startup failed
- **WHEN** an authenticated user selects existing tags and creates a new tag for a REST-backed bookmark while the injected adapter provides no local writer
- **THEN** confirmation submits the operation through the existing REST tag API
- **AND** successful returned tags appear on the bookmark
- **AND** no generic failure is shown solely because the adapter exists

#### Scenario: Removing a tag after startup fallback
- **WHEN** an authenticated user removes an editable tag association from a REST-backed bookmark while local startup is unavailable
- **THEN** the operation uses the existing REST removal API with that bookmark and tag identity
- **AND** the association is removed from the displayed state after success

#### Scenario: Local writer is available
- **WHEN** the same editing actions are performed with an available local writer
- **THEN** writes retain the local-first path and local identifiers
- **AND** no duplicate REST write is issued

### Requirement: Tag editing preserves the identity of its data source

The bookmark and tag identifiers passed to editing operations SHALL match the source of the displayed data. REST-backed list items SHALL retain their existing REST bookmark identifier or supported bookmark-user identifier when an adapter is present without a writer. Local UUIDs SHALL NOT be reinterpreted as REST identifiers. A local write failure SHALL NOT automatically replay the operation through REST.

#### Scenario: REST bookmark has only its normal identifier
- **WHEN** a REST-backed list item has a valid bookmark identifier and no bookmark-user identifier, and the database is unavailable
- **THEN** tag editing retains and uses the valid REST bookmark identifier
- **AND** the parent component does not replace it with zero because an adapter was injected

#### Scenario: Supported bookmark-user identity is available
- **WHEN** a REST-backed editable surface supplies a supported bookmark-user identifier without a normal bookmark identifier
- **THEN** tag editing continues to use the existing REST bookmark-user identity contract

#### Scenario: REST-backed article also carries a detail UUID
- **WHEN** an article has REST-backed tags and a valid REST bookmark identity alongside a detail UUID, and no local writer is available
- **THEN** tag editing uses the valid REST identity
- **AND** the detail UUID alone does not block REST or reinterpret the tag identifiers

#### Scenario: An available local writer rejects a mutation
- **WHEN** a local tag write fails after being submitted to an available local writer
- **THEN** the operation reports failure without automatically submitting a REST mutation
- **AND** the original local identifiers are not converted to REST identifiers

#### Scenario: Only local identity is available without a writer
- **WHEN** an editable surface contains only local UUIDs and has no local writer
- **THEN** it does not submit those UUIDs as REST bookmark or tag identifiers
- **AND** it preserves the current state and reports that the operation failed

### Requirement: Failed REST edits preserve user-visible state

REST tag edits SHALL preserve pending additions or the current tag association when the request fails, is rejected, or yields no successful result. They SHALL release the operation's loading state and allow deliberate retry without reporting a successful change. Existing read-only restrictions SHALL continue to prevent tag mutation.

#### Scenario: REST add request fails
- **WHEN** a REST tag-add request fails
- **THEN** pending selections and new-tag input remain available for retry
- **AND** no successful change is emitted

#### Scenario: REST removal request fails
- **WHEN** a REST tag-removal request fails or yields no successful result
- **THEN** the tag remains visible and no successful removal is emitted
- **AND** the user can retry the operation

#### Scenario: Tags are read-only
- **WHEN** a read-only bookmark is displayed during REST fallback
- **THEN** fallback does not expose or execute tag mutation actions
