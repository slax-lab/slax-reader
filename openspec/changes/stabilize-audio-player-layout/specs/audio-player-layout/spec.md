## ADDED Requirements

### Requirement: Snapshot audio enhancement preserves the initial reading position

The Web snapshot reader SHALL reserve the audio player's resting space before enhancement and SHALL retain the article container and introduction position when the native fallback becomes the enhanced player. It SHALL retain the player's existing location outside the annotation root and its sticky behavior. Complete article and raw transcript data SHALL remain available without recapture.

#### Scenario: Enhancement occurs after initial paint
- **WHEN** a saved audio article is enhanced under otherwise unchanged layout
- **THEN** the article container and introduction retain their positions
- **AND** the same text/image nodes and all transcript cues remain available
- **AND** highlighting, image preview, playback, chapter seek and persisted resume retain their existing behavior

#### Scenario: Enhancement is delayed or unavailable
- **WHEN** the snapshot is painted before its processors run or JavaScript is unavailable
- **THEN** native audio controls remain visible and usable in the reserved space
- **AND** the complete article is readable without waiting for playback or enhancement

#### Scenario: Enhanced audio is scrolled
- **WHEN** the reader scrolls through the original article or its translation
- **THEN** the existing audio player remains sticky outside the annotation root

### Requirement: Empty podcast status retains no reading gap

A PodcastBar with no status message and no translation switch SHALL contribute no bottom margin while retaining its live-region semantics. Its nonempty working, error and translation states SHALL retain existing controls and spacing.

#### Scenario: Finished article has no status action
- **WHEN** the empty podcast status section mounts after the article has painted
- **THEN** it adds no vertical gap or movement to the player or article

#### Scenario: A status message or translation switch is displayed
- **WHEN** the podcast has working/error text or a translation switch
- **THEN** its existing visible status, actions, announcements and spacing remain available
