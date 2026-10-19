# Spec Delta

## Purpose

Define the macOS window, appearance, native command surfaces and lifecycle that make the desktop library and reader behave consistently with the operating system.

## ADDED Requirements

### Requirement: Native window chrome and sidebar

The desktop application SHALL use native macOS traffic lights and an overlay title bar with a draggable toolbar. Its sidebar SHALL use the system sidebar material with active/inactive-window behavior, while reading content has an opaque surface. Controls MUST remain reachable when the sidebar is hidden or the window is resized.

#### Scenario: Focus and resize

- **WHEN** the user changes focus, resizes the window or toggles the sidebar
- **THEN** traffic lights, navigation, toolbar hit targets and reading content remain usable and correctly positioned

#### Scenario: Optional material unavailable

- **WHEN** the selected optional material is unsupported by the running operating system
- **THEN** the window uses the system sidebar material without blocking launch

### Requirement: System appearance and accessibility

The application shell SHALL follow system light/dark appearance and reduced motion. It SHALL respond to reduced transparency at startup and during runtime by replacing toolbar blur/translucency with an opaque readable surface. The article reader SHALL preserve its light appearance. Interactive controls SHALL have localized accessible names, visible keyboard focus and usable target sizes.

#### Scenario: Accessibility setting changes

- **WHEN** reduced transparency changes while the app is open
- **THEN** the toolbar switches to an opaque surface and content and controls retain readable contrast

#### Scenario: Dark appearance

- **WHEN** system appearance becomes dark
- **THEN** the shell follows dark appearance and the article remains readable in its light profile

### Requirement: Native menu command behavior

The application SHALL provide native About, Settings (Cmd+,), Quit, Edit, View and Article menus. Edit commands SHALL preserve native text editing shortcuts. View commands SHALL navigate Inbox, Starred and Archive and toggle the sidebar. Article commands SHALL star, archive and open the original for the currently authorized selection. Unavailable commands SHALL be disabled.

#### Scenario: Edit shortcuts

- **WHEN** a user types into an editable control and invokes copy, paste, undo or redo
- **THEN** the native editing operation applies to the focused control without triggering a library command

#### Scenario: Selection disappears

- **WHEN** a bookmark is removed or the account changes before a menu action executes
- **THEN** the stale action does not mutate another bookmark or account

### Requirement: Native contextual actions

Bookmark rows, selected reader text and reader links SHALL offer native context menus with actions appropriate to the selected content and current permissions. Destructive or external actions SHALL obey the same policy as toolbar actions.

#### Scenario: Reader selection context menu

- **WHEN** the user opens a context menu over selected article text
- **THEN** highlight, comment and copy actions target that active document selection

#### Scenario: Unauthorized selection

- **WHEN** the current user cannot annotate the selected document
- **THEN** annotation commands are disabled and the core rejects an attempted mutation

### Requirement: Hide close and explicit quit

Closing the main window SHALL hide it without terminating synchronization or downloads. Dock activation SHALL restore and focus the existing window. Cmd+Q SHALL perform an orderly shutdown of account work. Hiding the window SHALL release or suspend hidden UI publication without retiring the account runtime.

#### Scenario: Close and reopen

- **WHEN** the user closes the window while downloads are active and then activates the Dock icon
- **THEN** background work remains owned and the restored window receives a current snapshot without duplicate runtimes

#### Scenario: Quit

- **WHEN** the user selects Quit
- **THEN** new work stops and owned resources are released before the process exits

### Requirement: Localized native presentation

The shell and native menu labels SHALL support English and Chinese and use system font conventions. Noneditable interface labels SHALL not be selectable; article content and editable controls SHALL remain selectable. Buttons SHALL use the normal arrow cursor.

#### Scenario: Chinese locale

- **WHEN** the user switches to Chinese
- **THEN** shell, menu, loading, empty, error and confirmation labels use the selected locale without truncating required actions

### Requirement: Persistent resizable workspace

Library and RSS SHALL use the same three-column structure, warm Web-aligned Desktop tokens, adjustable navigation/list widths and an icon-only sidebar. Layout choices SHALL persist through Rust preferences.

#### Scenario: Switch to RSS

- **WHEN** the user switches between the library and RSS
- **THEN** the shell remains mounted, RSS feeds occupy the sidebar and entries and reading content occupy the second and third columns without a full-workspace loading flash

#### Scenario: Adjust columns

- **WHEN** the user drags a divider, uses its keyboard controls or collapses navigation
- **THEN** readable column bounds are respected and the layout is restored on restart

### Requirement: Direct source navigation

The sidebar SHALL display all RSS and subscribed Collection sources directly beneath personal library navigation, without a standalone RSS destination. Selecting any source SHALL retain the sidebar, use the second column for that source's articles and the third for reading. Collection data SHALL come from the account's admitted SQLite subscription rows and preserve existing access rights.

#### Scenario: Select a source

- **WHEN** the user selects an RSS feed or Collection in the sidebar
- **THEN** that source's articles appear in the middle column while the same three-column workspace remains mounted

### Requirement: Refined warm-paper workspace composition

The desktop shell SHALL present a deliberate three-layer warm-paper composition: a translucent native sidebar, an opaque list surface with card-like article rows, and an opaque reading surface. The shell SHALL keep a visually dominant primary save action, an unambiguous current-location treatment, unread and processing indicators, and pointer selection distinct from keyboard focus. Empty, loading, processing, settings and dialog states SHALL use the same semantic token layer and editorial typography as the rest of the shell.

#### Scenario: Library composition

- **WHEN** the user views the library or RSS workspace at a supported window size
- **THEN** navigation, list and reading surfaces remain visually distinct, the active source and selected row are unambiguous, and the save action reads as the primary action

#### Scenario: Pointer and keyboard selection

- **WHEN** the user selects a row with a pointer or moves focus with the keyboard
- **THEN** pointer selection uses the row's selected treatment without a hard focus rectangle, while keyboard focus remains visibly indicated

#### Scenario: Reader and settings states

- **WHEN** no article is selected, an article is processing, or the settings page is open
- **THEN** the state uses the refined editorial hierarchy, readable contrast in light and dark appearance, and does not duplicate the page title
