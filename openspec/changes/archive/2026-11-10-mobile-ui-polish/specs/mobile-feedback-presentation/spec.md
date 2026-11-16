# Spec Delta

## Purpose

Provide a clear Mobile Feedback form with header submission, ordered localized consent options, and keyboard dismissal that preserves editing and direct control interaction.

## ADDED Requirements

### Requirement: Feedback submission is available in the header

Feedback SHALL expose its single localized Submit action at the upper right. It SHALL be disabled for empty or whitespace-only content, while submission is pending, or after account/environment ownership becomes invalid. One non-whitespace character SHALL satisfy the existing required-content rule. The lower submit/cancel row and dedicated keyboard-dismiss actions SHALL be removed; native Back SHALL retain the existing exit/cancellation behavior. Contextual article information and existing success, error, retry, and draft-retention behavior SHALL remain functional.

#### Scenario: Content changes update submission availability
- **WHEN** a new feedback draft is empty, contains only whitespace, gains a non-whitespace character, and is cleared again
- **THEN** the header action is respectively disabled, disabled, enabled, and disabled
- **AND** its accessibility disabled state matches its actual availability

#### Scenario: Header submission runs once
- **WHEN** the user activates the enabled header action with the keyboard open
- **THEN** the keyboard closes and the existing feedback submission runs once with the current content and consent choices
- **AND** the localized submitting state prevents another submission while pending

#### Scenario: Failure or ownership change is reflected in the header
- **WHEN** submission fails with the same account/environment
- **THEN** the draft and consent remain available and submission becomes available for retry
- **AND** an account/environment ownership change instead disables submission until Feedback is reopened

### Requirement: Feedback consent options follow the reference order and copy

The form SHALL show follow-up first and diagnostic attachment second, separated by a subtle divider. English follow-up copy SHALL read `Allow follow-up at {email}`; Chinese SHALL read `允许通过 {email} 进行跟进`, with the actual account email and no surrounding brackets in visible or accessibility labels. Chinese attachment copy SHALL read `附带最近七天的诊断日志，仅用于定位问题`; English SHALL convey the same meaning. Follow-up SHALL keep its existing default-selected state and attachment SHALL remain independent and default-unchecked. Selecting or deselecting attachment SHALL NOT expand additional visible copy. The existing localized attachment disclosure SHALL remain available to assistive technology. Both rows SHALL use 12-point circular checkbox artwork with their 14-point base text, retain a minimum 48-point row touch height, expose their label, checked state, and disabled state, and accommodate wrapped text.

#### Scenario: A new draft presents the two independent options
- **WHEN** the user opens Feedback in Chinese or English
- **THEN** follow-up appears before attachment with localized reference wording and the user's email
- **AND** follow-up is selected, attachment is unchecked, and only the concise option label is visible

#### Scenario: Attachment selection retains concise row text
- **WHEN** the user selects the attachment option
- **THEN** only the checked state changes and the visible option text stays unchanged
- **AND** follow-up selection is unchanged
- **AND** deselecting attachment retains the same visible text and the existing submission-without-logs behavior

### Requirement: Background taps dismiss the keyboard while consent taps preserve editing

On iOS and Android, tapping form background or article context outside the feedback editor SHALL dismiss the keyboard without changing or submitting the draft. A consent-row tap SHALL toggle that row once while preserving the input's existing focus, text selection, and keyboard state. It SHALL NOT dismiss the keyboard or force focus when the keyboard is closed. Header Submit SHALL retain keyboard dismissal, and native Back SHALL exit normally. Tapping or selecting within the editor SHALL retain editing focus and multiline behavior. Existing drag dismissal, keyboard avoidance, safe-area layout, and scroll reachability SHALL remain functional on small screens.

#### Scenario: Background or contextual information is tapped
- **WHEN** the keyboard is open and the user taps form background or article context outside the editor
- **THEN** the keyboard closes and the draft and consent choices are unchanged
- **AND** no feedback is submitted

#### Scenario: A consent row is tapped while editing
- **WHEN** the keyboard is open and the user taps either enabled consent row
- **THEN** that row toggles exactly once while the input remains focused and the keyboard stays visible
- **AND** the draft and cursor remain available for continued typing without refocusing

#### Scenario: A consent row is tapped with the keyboard closed
- **WHEN** the input is not focused and the user taps either enabled consent row
- **THEN** that row toggles without opening the keyboard or focusing the input

#### Scenario: Editing remains usable
- **WHEN** the user taps inside the editor, selects text, or enters a newline
- **THEN** the editor retains focus and the operation works normally
- **AND** a long draft and the consent controls remain reachable with the keyboard open on a small device

### Requirement: Editor fills available height above bottom-anchored consent

On entry, Feedback SHALL place its consent rows at the bottom of the usable screen above the safe area, with the editor filling the remaining space below the header and optional article context. Opening the keyboard SHALL move both consent rows above the keyboard and reduce the editor's height. Closing the keyboard SHALL restore the available height without clearing content or changing consent. Long drafts SHALL scroll inside the input instead of expanding the form and moving the consent rows offscreen. Layout SHALL use the actual available viewport, header offset, and safe-area geometry rather than a fixed keyboard height.

#### Scenario: Feedback opens without the keyboard
- **WHEN** the user enters Feedback before focusing the input
- **THEN** the consent group sits at the bottom of the usable viewport with ordinary form padding
- **AND** the input fills the remaining height above it

#### Scenario: Keyboard opens and closes
- **WHEN** the user focuses the input and subsequently dismisses the keyboard
- **THEN** the consent group first rises above the keyboard and the input shrinks, then the group returns to the bottom safe area and the input expands
- **AND** content and consent remain unchanged

#### Scenario: Long feedback remains editable above the options
- **WHEN** the draft has more lines than fit in the available input height
- **THEN** the input can scroll internally while the consent group remains at the bottom of the available viewport
- **AND** contextual article information and wrapped consent labels do not make the input grow with draft length
