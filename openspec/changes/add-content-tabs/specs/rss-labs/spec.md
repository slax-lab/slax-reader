# Spec Delta

## MODIFIED Requirements

### Requirement: Native application RSS user experience

The native app SHALL provide Labs settings, subscription management, and article lists through its existing native application surfaces. Each RSS subscription source SHALL appear beside My Inbox and Collections in the Inbox source rail with circular icons for direct content selection, without a separate RSS home route. Articles SHALL open through the existing shared bookmark reader in RSS source mode, retaining reader typography, platform scrolling, and image viewing. Preview SHALL not create bookmarks; saving SHALL require an explicit user action.

When subscriptions exist, the source rail SHALL keep an All source first, representing the merged timeline and serving as the default selection. Users SHALL be able to return to All after selecting one subscription. When changing sources, the app SHALL reset the incoming list's scroll position before displaying it; the source rail's own horizontal position SHALL not reset.

#### Scenario: Shared bookmark reader
- **WHEN** an Android or iOS user opens an RSS entry containing images
- **THEN** the existing bookmark reader displays the backend-sanitized cached HTML using its existing layout, scrolling, and image viewer without starting bookmark synchronization, annotation, or AI operations

#### Scenario: Select an RSS source beside collections
- **WHEN** the user selects an RSS circular source icon on the native home screen
- **THEN** its articles appear on the same home surface, the icon is selected, and choosing My Inbox or a Collection returns directly to that content without a second RSS source row or an additional Inbox dropdown item

#### Scenario: Return to all sources after selecting one
- **WHEN** the user selects a subscription and then the leading All source
- **THEN** the merged timeline appears, All is selected, and individual source icons are no longer selected

#### Scenario: Switch sources while the previous source is scrolled
- **WHEN** the user changes from a scrolled RSS source to another source or All
- **THEN** the new source starts at the top without restoring the previous source's scroll position
- **AND** the source rail keeps its current horizontal position

#### Scenario: Add a source from the shared rail
- **WHEN** the user selects Add RSS at the end of the source rail
- **THEN** confirmed RSS enablement opens the existing-style unified add dialog with Feed selected, while a disabled feature retains the existing Settings destination; the name remains optional and editable, failure retains input and error feedback, and success closes the dialog and selects the added subscription

#### Scenario: Settings only controls the RSS experiment
- **WHEN** the user enables or disables RSS in native Settings
- **THEN** Settings only reads and writes Labs state without loading subscriptions or articles or navigating to content; a failed enable operation preserves the last confirmed state and offers retry

#### Scenario: RSS uses Inbox feed components
- **WHEN** the user opens enabled RSS content
- **THEN** the app reuses the Inbox source rail, navigation, separators, and rounded list; sources use circular site icons, text fallback, and names, and rows show source/time, title, summary, and a right-hand thumbnail; existing subscription editing and removal retain their menus and bottom panels, while new subscriptions use the unified add dialog

#### Scenario: Save before bookmark synchronization completes
- **WHEN** the backend confirms a save before local bookmark synchronization completes
- **THEN** the current RSS detail and home cache immediately reflect the saved state while preserving reading position, without waiting for synchronization or automatically navigating

#### Scenario: Save actions in the shared reader
- **WHEN** the user reads an RSS article
- **THEN** the detail header offers Save to Inbox and Open original; long articles also show a save action at the end, short articles do not duplicate it, and image or viewport changes update measurements while both save controls share busy and saved state

#### Scenario: Return to the source list
- **WHEN** the user returns from detail or switches between RSS and Inbox
- **THEN** the original list retains its cache, selection, and scroll position without previewing or saving recreating the home page
