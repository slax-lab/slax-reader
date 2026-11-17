# Spec Delta

## Purpose

Provide one predictable content-addition surface on Web and Mobile while preserving explicit acquisition intent, existing application presentation, and feature authorization.

## ADDED Requirements

### Requirement: Acquisition modes share the existing add dialog

Web and Mobile SHALL offer URL, Feed, and File modes inside their existing add-dialog presentation. The visible mode order SHALL be URL, Feed, File. URL SHALL remain available; Feed SHALL appear only when the current account's loaded Labs state enables RSS, and File SHALL appear only when its loaded Labs state enables PDF. A single remaining mode SHALL not require an otherwise empty tab bar. Unconfirmed feature state SHALL not block URL entry or expose an experimental mode. Existing application-specific colors, typography, dialog placement, dimensions, spacing, and button treatment SHALL be preserved except for the added tab strip and mode-specific content. Mobile SHALL retain a centered dialog rather than introducing a bottom-sheet redesign.

#### Scenario: Enabled combinations
- **WHEN** the user opens Add with RSS and PDF both enabled, only RSS enabled, only PDF enabled, or both disabled
- **THEN** the surface respectively exposes URL/Feed/File, URL/Feed, URL/File, or URL only

#### Scenario: Open from a contextual entry
- **WHEN** the user opens the ordinary add entry or an enabled RSS add entry
- **THEN** the same surface opens with URL or Feed respectively selected

#### Scenario: Gate changes while open
- **WHEN** a confirmed Labs response disables the active experimental mode
- **THEN** that mode disappears, the surface selects URL without submitting, and feed hints disappear when RSS is disabled

### Requirement: Possible feed URLs receive an optional local hint

Only URL mode with confirmed RSS enablement SHALL evaluate a valid HTTP(S) address for likely feed structure. A bounded policy SHALL recognize explicit feed/rss/atom path segments, conventional feed filenames or rss/atom suffixes, and explicit feed-format query keys and values. It SHALL NOT use unrestricted substring matching, bare xml suffixes, fragments, free-text search parameters, or tracking parameters as sufficient evidence. Detection SHALL NOT fetch the address, modify it, create a subscription, or prevent ordinary URL saving.

#### Scenario: Positive feed shapes
- **WHEN** the address ends in `/feed/`, `/rss.xml`, or `/updates.atom`, or contains `?feed=rss2` or `?format=atom`
- **THEN** the surface displays a localized possible-feed hint only when RSS is enabled

#### Scenario: Avoid obvious false positives
- **WHEN** the address contains `/feedback`, `/articles/rss-reader-review`, `?q=rss`, `?utm_source=feed`, a bare `.xml` suffix, or only `#rss`
- **THEN** those features alone do not display a feed hint

#### Scenario: Explicit switch
- **WHEN** the user activates the hint's switch action
- **THEN** Feed becomes selected with the complete current address preserved, and no network request occurs until the user submits Add feed

#### Scenario: Dismiss a hint
- **WHEN** the user chooses to continue as a URL
- **THEN** the hint remains dismissed for that unchanged address in the current open session and ordinary URL saving remains available

#### Scenario: RSS is disabled
- **WHEN** an address resembling a feed is entered or supplied by existing clipboard prefill while RSS is disabled or unconfirmed
- **THEN** no candidate detection or RSS hint occurs and no enable-RSS promotion appears in this surface

### Requirement: Mode switching preserves the active session draft

URL and Feed SHALL carry the complete address between modes without dropping query values. The optional feed name and selected file SHALL remain available when switching away and back. Errors SHALL belong to their mode. Switching to File SHALL not automatically invoke the system picker; canceling the picker SHALL return to the same add session. Closing the entire session SHALL reset its drafts and release owned temporary file resources. A submission in progress SHALL prevent a competing mode submission.

#### Scenario: Switch and return
- **WHEN** the user edits a feed name or selects a PDF, visits another mode, and returns
- **THEN** the previous name or selected file remains without duplicate requests or silent replacement

#### Scenario: File picker cancellation
- **WHEN** the user opens and cancels the file picker
- **THEN** File remains selected and the existing session draft is preserved

### Requirement: Existing acquisition semantics remain intact

URL saves SHALL preserve current local-first behavior, duplicate protection, and first-party bookmark handling. Feed SHALL retain an optional name, existing subscription validation, duplicate and quota handling, and failure feedback. File SHALL accept one nonempty PDF of at most 50 MiB under the existing PDF authorization. Renaming bookmark titles and editing existing subscriptions SHALL remain separate from acquisition tabs. No new format or backend discovery capability SHALL be implied.

#### Scenario: Existing editor
- **WHEN** the user edits a bookmark title or an existing subscription name
- **THEN** the existing editor remains available without acquisition tabs

#### Scenario: Feed or upload failure
- **WHEN** the server rejects a feed or PDF upload
- **THEN** the active mode displays the existing understandable failure and retains retryable input without reporting success

### Requirement: Tabs remain accessible in existing profiles

The add surface SHALL expose labelled tabs and selection state, support Web keyboard navigation and focus restoration, and keep visible controls reachable on narrow screens and above the native keyboard. Web SHALL support light, dark, and e-ink presentation, and Mobile SHALL preserve its source light profile under supported system appearances. Chinese and English labels SHALL remain usable without horizontal overflow.

#### Scenario: Keyboard and narrow display
- **WHEN** the user navigates the Web tabs by keyboard or opens the surface on a narrow display
- **THEN** only the active panel is interactive, focus is visible, and the active form and action remain reachable
