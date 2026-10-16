# Mobile Reader Parity Spec Delta

## Purpose

Preserve the existing rich article and RSS reading experience, especially accurate text selection, historical annotations, media, and offline content.

## ADDED Requirements

### Requirement: Article presentation preserves source content and states

The reader SHALL preserve the existing article HTML, scoped styles, title/date/original-link/tags, initial skeleton, AI overview, scroll-responsive tools, and source loading/error/refresh feedback. Personal and shared collection articles SHALL retain their distinct ownership context. A plain-text or paragraph-only rendering MUST NOT substitute for source rich content.

#### Scenario: A mixed-content article opens
- **WHEN** an article contains images, lists, links, code, formulas, tables, or supported embedded content
- **THEN** it retains the source rendering and applicable interactions
- **AND** app-shell styles do not inadvertently rewrite embedded article presentation

### Requirement: Arbitrary selection and historical marks remain accurate

Users SHALL retain arbitrary text selection, cross-paragraph handle dragging, copy, highlight creation/removal, and comment creation with correctly placed contextual controls. Existing node-path/offset and contextual-text annotations SHALL resolve to the correct content after migration; overlapping stroke/comment appearance and clicking an existing mark SHALL retain source behavior.

#### Scenario: A user selects across paragraphs
- **WHEN** selection spans multiple text nodes and paragraphs
- **THEN** the exact selected range can be copied, highlighted, or commented on
- **AND** scrolling, safe-area offsets, and selection handles do not misplace the action menu

#### Scenario: Historical marks are restored
- **WHEN** a saved article contains legacy path-based or approximate-text marks
- **THEN** those marks attach to the intended text
- **AND** migration does not silently discard the source range or replace it with whole-paragraph selection

### Requirement: Comments retain threading and permissions

The reader SHALL preserve quoted excerpts, profiles/timestamps, threaded replies, expansion, own-comment deletion confirmation, reply prefixes, keyboard/focus handling, discard confirmation, copy/line actions, nonempty validation, and the existing 1500-character limit. Shared collection permissions SHALL govern mark visibility, profile display, and creation/deletion independently of personal-bookmark permissions.

#### Scenario: A user replies to a shared-collection comment
- **WHEN** the source permissions allow that reply
- **THEN** the reply attaches to the correct thread and author context
- **AND** a denied action remains unavailable even when a panel is already open

### Requirement: Tags and article actions preserve optimistic behavior

The reader SHALL preserve assignment/removal, creation, autocomplete and existing-name reuse, title editing, star/archive/delete where allowed, manual caching, outbound sharing, original opening, and contextual feedback. Pending local edits SHALL merge correctly with streamed remote state.

#### Scenario: A tag is created while synchronization is delayed
- **WHEN** the user creates or assigns a tag before the remote stream catches up
- **THEN** the tag appears with the source optimistic behavior
- **AND** a later stream update does not drop, duplicate, or undo that edit

### Requirement: AI and outline panels retain streaming and cache behavior

The reader SHALL preserve overview/key-takeaway streaming, cached/offline results, expanded summary panels, Pro-gated outline generation, Markdown rendering, collapse/expand/hide states, outline anchor jumps, panel scroll restoration, and source metrics. Pending operations and errors SHALL remain visible and cancellable with the original navigation behavior.

#### Scenario: Cached AI content is read offline
- **WHEN** cached overview or outline content exists without connectivity
- **THEN** that content remains readable
- **AND** uncached requests show the source offline state rather than fabricated results

### Requirement: Images and video transcripts retain interactions

The reader SHALL preserve cache-aware fullscreen image paging, count, dismissal, pinch/pan/double-tap zoom, and supported embedded video playback. YouTube transcript panels SHALL retain current-cue positioning and cue-to-seek/play actions without reloading the article or losing reading state.

#### Scenario: A transcript cue is selected
- **WHEN** the user selects a cue in an article with supported YouTube content
- **THEN** the embedded player seeks and plays at that cue
- **AND** the source scrolling and transcript state remain consistent

### Requirement: Reading positions and cached resources survive lifecycle changes

The reader SHALL retain separate article and outline positions, source debounce behavior, immediate flushing on exit/background, continue-reading context, and cached article/image delivery. Resource interception SHALL preserve cancellation and safe original-content fallback. Platform-specific scrolling coordinates SHALL be translated correctly rather than copied between Android and iOS.

#### Scenario: The reader backgrounds before a debounce expires
- **WHEN** the user scrolls and immediately backgrounds or leaves the page
- **THEN** the latest position is persisted
- **AND** reopening the same personal or collection article restores the intended position and context
