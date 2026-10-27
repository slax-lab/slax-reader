# youtube-captions Specification

## Purpose
Select the caption track of a saved YouTube video so that the reader shows the captions in the original language of the video when possible.

## Requirements

### Requirement: Caption track selection

The system SHALL select one caption track from the provider track list in this order. If an ASR track exists, the system SHALL select the manual track in the ASR language, or the ASR track when no such manual track exists. Otherwise, the system SHALL select the manual track in the user's language, then the manual English track, then the first track. Language comparison SHALL ignore the `a.` prefix, letter case and region tags.

#### Scenario: Uploaded translations without an ASR track

- **WHEN** a video has manual tracks `ar`, `bn`, `nl`, `en` and more, no ASR track, and the user's language is `zh`
- **THEN** the system selects the `en` track

#### Scenario: User language track exists

- **WHEN** a video has manual tracks `fr`, `zh-Hans` and `en`, no ASR track, and the user's language is `zh`
- **THEN** the system selects the `zh-Hans` track

#### Scenario: ASR track gives the original language

- **WHEN** a video has manual tracks `zh-Hans` and an ASR track `a.en`, and the user's language is `zh`
- **THEN** the system selects the `a.en` track
