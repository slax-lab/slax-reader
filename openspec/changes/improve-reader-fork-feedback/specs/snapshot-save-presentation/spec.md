## MODIFIED Requirements

### Requirement: Localized save-state presentation

The public reader SHALL explain that saving lets the reader return to the article later. Submission and background copying SHALL have visible in-place progress. Only confirmed successful publication SHALL produce the localized saved state. A newly observed completion after the reader's action SHALL show a success confirmation, with a visually secondary link to their saved articles. The page SHALL retain reading position until the reader chooses to navigate.

#### Scenario: Reader has not saved the source

- **WHEN** a non-owner is eligible and ready to save
- **THEN** the desktop header offers “Save for later” or “稍后再看” and the mobile card explains how to return to the article next to “Save” or “稍后再看”

#### Scenario: Save is admitted or already persisted

- **WHEN** admission completes and copying is still pending
- **THEN** the action stays busy and prevents duplicate saves while the reader can continue reading
- **WHEN** viewer-specific status confirms successful publication after the reader's action
- **THEN** the confirmation states that the article was saved, shows a filled star, and offers a quiet text link to saved articles
- **WHEN** an already-saved source is revisited
- **THEN** a compact saved indicator appears without replaying the prompt or completion animation

#### Scenario: Email confirmation arrives after publication

- **WHEN** the current viewer receives confirmation that the provider accepted the receipt for this save
- **THEN** the success confirmation on either layout gains a localized email-sent line
- **WHEN** the receipt is pending, inapplicable, unavailable or failed
- **THEN** the saved confirmation remains accurate and contains no email-sent claim

#### Scenario: Request is in flight or fails

- **WHEN** a request is in flight
- **THEN** the action immediately shows localized progress and blocks duplicate activation
- **WHEN** admission or background copying fails
- **THEN** the reader sees an actionable failure in context and may explicitly retry
- **WHEN** a status check temporarily fails after admission
- **THEN** the page retains the accepted processing state and can reconcile it without resubmitting the copy

### Requirement: Accessible theme-aware visual treatment

The desktop header SHALL give the action primary emphasis. At widths of 768px and below a single non-modal bottom card SHALL provide the primary action, account for safe-area insets and preserve access to article content and related controls. Controls SHALL have a minimum 44px hit area, visible keyboard focus and full localized text.

#### Scenario: Theme changes

- **WHEN** light, dark or e-ink is selected
- **THEN** the save, busy, saved and failure states remain readable and distinguishable through wording and shape
- **WHEN** reduced motion or e-ink is active
- **THEN** transitions and continuous spinner motion are suppressed and the state text remains available

#### Scenario: Keyboard and assistive technology

- **WHEN** the reader uses keyboard or assistive technology
- **THEN** the primary action activates through Enter or Space, decorative icons are hidden, status changes are announced without moving focus, and new receipt information is announced once

#### Scenario: Responsive localized header

- **WHEN** a reader views the page at desktop, 768px or 320px in either locale
- **THEN** the appropriate single action, notes, share controls and any media controls remain reachable without overlap, clipping, or horizontal scrolling
- **WHEN** a mobile panel or login dialog opens
- **THEN** the save card yields to it and restores the current state when the reader returns

### Requirement: Presentation preserves existing save eligibility

The action SHALL respect ownership, metadata readiness, online submission and the existing explicit save continuation after authentication. It SHALL isolate pending, receipt and success feedback by account and source while retaining the source page after admission.

#### Scenario: Metadata is unready

- **WHEN** viewer-specific metadata is unavailable
- **THEN** the page does not offer an active save or infer a successful copy
- **WHEN** the viewer owns the source
- **THEN** the prompt is absent

#### Scenario: Saved copy becomes retryable

- **WHEN** fresh authoritative viewer state reports a failed or subsequently absent copy
- **THEN** the reader can explicitly save again once eligible

#### Scenario: Sign-in and context changes

- **WHEN** an anonymous visitor explicitly saves and completes the associated sign-in
- **THEN** the single intended save of another reader’s article resumes automatically with feedback on the source page
- **WHEN** sign-in identifies the visitor as the source owner
- **THEN** the reader returns to the source without an additional copy or receipt
- **WHEN** the visitor cancels sign-in or changes account or source
- **THEN** no stale completion, email claim or save prompt from the previous context is shown
