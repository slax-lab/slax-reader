# Spec Delta

## Purpose

Keep Extension chat multiline editing predictable and ensure its collection popup remains visible above ordinary high-stacking page content.

## ADDED Requirements

### Requirement: Multiline chat input preserves native caret behavior

Shift+Enter in the Extension chat SHALL use native textarea newline and caret behavior without sending a message or applying a competing manual caret update. The existing platform-specific explicit newline shortcut SHALL remain available, while plain Enter retains existing send behavior and composition safeguards.

#### Scenario: Shift+Enter in the middle of text

- **WHEN** a user presses Shift+Enter at a caret position inside the chat textarea
- **THEN** one newline is inserted by native editing and the caret stays at the native insertion position without sending

#### Scenario: Explicit newline shortcut

- **WHEN** a user presses Command+Enter on macOS or Control+Enter on a non-macOS platform
- **THEN** a newline is inserted and the caret advances to the inserted newline without sending

### Requirement: Collection popup host has an elevated stacking level

The Extension collection-popup host SHALL establish a high stacking level while retaining its existing fixed positioning and visibility behavior so ordinary high-z-index page elements do not obscure it. This does not promise precedence over browser UI or elements in the browser top layer.

#### Scenario: Page contains a high-stacking banner

- **WHEN** the user opens the collection popup over a page banner with a lower effective stacking level
- **THEN** the collection popup remains visible and interactive above the banner
