# Spec Delta

## ADDED Requirements

### Requirement: Native settings switches preserve setting behavior

Mobile settings SHALL use platform-native switch controls while retaining the existing persisted value, change callback, accessibility label, disabled/loading state and failure handling for each option. Switching one option SHALL NOT change another option or bypass its controller.

#### Scenario: A setting change succeeds or fails
- **WHEN** a user toggles an available setting
- **THEN** the existing setting controller receives the chosen value once
- **AND** server-backed controls remain disabled while pending and reflect the actual result, with existing retry/error feedback on failure

### Requirement: Source selection preserves loaded avatars

Switching Collection or RSS sources within the active account SHALL retain loaded source avatars and the source-strip identity. It SHALL replace article rows and reset their scroll position as before without treating replacement rows as prepends. Actual account replacement SHALL retain existing resource isolation.

#### Scenario: A source selection changes
- **WHEN** the user selects another source in the current Collection or RSS strip
- **THEN** unchanged source avatars remain mounted without a placeholder reload
- **AND** only the selected source and its article data change, with the expected scroll reset

#### Scenario: The active account changes
- **WHEN** the active native resource owner changes
- **THEN** previous-account rows, avatars and captured callbacks cannot populate the replacement account

### Requirement: Feedback opens ready for text entry

Entering the Feedback screen SHALL autofocus its editable input and present the native keyboard, preserving its draft, owner checks, keyboard avoidance and submit behavior.

#### Scenario: Feedback opens from the sidebar
- **WHEN** the user opens Feedback from the Library sidebar
- **THEN** the feedback input receives focus and the keyboard is available without an additional tap

### Requirement: Keyword clearing preserves independent filters

The Search keyword clear control SHALL appear only when the keyword input contains text and SHALL clear only that text. Selected tags and source scope SHALL retain their independent controls. Reader-style tag chips SHALL retain the existing tag-selection callbacks, selected/available eligibility, filtering, multi-tag query semantics and Done dismissal.

#### Scenario: Tags are selected without keyword text
- **WHEN** tags or source scope are active and the keyword field is empty
- **THEN** the keyword clear control is absent

#### Scenario: Keywords are cleared with active filters
- **WHEN** the user presses the keyword clear control
- **THEN** only the keyword is cleared and independent tag/source filters remain selected


### Requirement: Feedback first focus respects keyboard avoidance readiness

Feedback SHALL initially focus its editable content after the native opening transition completes and its keyboard-avoidance surface has a settled measured screen offset. The first keyboard presentation SHALL keep both follow-up and log-attachment options reachable above the keyboard. Subsequent layout measurements SHALL not reopen the keyboard or steal focus. Draft, consent and submission behavior SHALL remain intact.

#### Scenario: Entering Feedback from the sidebar
- **WHEN** the Feedback screen completes its opening transition and settled layout measurement
- **THEN** its input focuses with the correct keyboard-avoidance offset and both consent options remain visible

#### Scenario: Feedback lays out again after dismissing the keyboard
- **WHEN** a later layout measurement occurs
- **THEN** the screen does not automatically focus the input again


### Requirement: Common reader preprocessing is rebuilt from upstream source

Mobile SHALL consume a generated upstream bridge with programmatic anchor-selection suppression and common image, empty-span, details, relative-link, table and iframe processing. Programmatic anchor highlighting SHALL not report a user selection; subsequent user selections SHALL still report normally. Images SHALL preserve authored WeChat sizing, settle already completed requests, recover after source replacement and retain native preview behavior. Spans containing line breaks SHALL remain visible; YouTube contents details SHALL retain their existing expansion state. Relative links SHALL resolve against original-page metadata. Tables SHALL fit short content and allow wide content to scroll without changing annotation-bearing DOM structure. Oversized iframe widths SHALL be constrained. Observers SHALL stop on teardown. Media-specific processors SHALL remain unchanged.

#### Scenario: Original-page metadata arrives after DOM readiness
- **WHEN** Mobile supplies the original page URL through InfoPack
- **THEN** relative links resolve against that URL and WeChat image processing retains authored dimensions even when the image already loaded

#### Scenario: A source-generated bridge replaces the imported script
- **WHEN** the rebuilt bridge is embedded into Mobile
- **THEN** anchor navigation remains suppressed as a user selection, real selection still works and provenance records the actual upstream source/build inputs

#### Scenario: Common content resizes and the Reader closes
- **WHEN** table/image dimensions change and then the Reader is torn down
- **THEN** layout updates preserve DOM paths and horizontal scroll, and their observers and pending frames are released

### Requirement: Native selection cancellation delivers pending annotation actions

Reader SHALL deliver a user-selected text range when native selection takeover cancels the touch after selection debounce has completed. Cancellation before debounce SHALL retain delayed delivery. The same range SHALL not produce duplicate notifications, and subsequent user gestures and programmatic anchor-selection suppression SHALL remain correct.

#### Scenario: Native takeover follows a settled selection debounce
- **WHEN** text is selected while touching the document and native takeover sends touchcancel after debounce has retained a pending range
- **THEN** Reader reports that range once and makes its available annotation actions visible

#### Scenario: Native takeover precedes selection debounce
- **WHEN** native takeover cancels the touch before debounce completes
- **THEN** the eventual user selection is reported once, and later real selections still work

### Requirement: Android comment editing remains above the keyboard

Reader's Android inline comment sheet SHALL avoid the visible native keyboard so its quote, editable draft and Send action remain reachable. Keyboard frame changes and dismissal SHALL restore the correct available viewport without subtracting keyboard height twice when the native window already resized. Existing iOS avoidance, comment persistence, dismissal and sheet motion SHALL remain intact.

#### Scenario: Keyboard opens and changes during comment editing
- **WHEN** the Android comment input focuses and the keyboard opens or changes height
- **THEN** the draft input and enabled Send action remain above the keyboard and can submit without dismissing it first

#### Scenario: Keyboard hides and the comment is reopened
- **WHEN** the keyboard hides and the saved comment is closed and reopened
- **THEN** the sheet regains its available height and the saved comment remains visible
