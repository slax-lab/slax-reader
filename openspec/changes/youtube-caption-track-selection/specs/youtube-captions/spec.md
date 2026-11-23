# YouTube captions delta

## MODIFIED Requirements

### Requirement: Caption track selection

The system SHALL use the first two characters of the capture locale as the user's language, falling back to `en` when the locale is empty. The comparison SHALL be case-insensitive.

The system SHALL treat tracks marked as automatic or carrying an `a.` language prefix as automatic. Language comparison SHALL ignore the prefix, letter case, and region or script subtags. Duplicate tracks and variants of the same base language SHALL count as one language when determining whether the automatic track list spans multiple languages.

- When automatic tracks span multiple languages, the system SHALL prefer a track in the capture user's Chinese or English language, then any listed English track. A capture language outside Chinese and English SHALL use English in this case.
- When automatic tracks cover one language, the system SHALL prefer a manual track in that language, then an automatic track in that language.
- When automatic tracks are absent, the system SHALL prefer a manual track in the capture user's language, then a manual English track, then a track in the sole available language if the list covers only one language.
- Within a preferred language, the system SHALL prefer a manual track when one is available. Selection of a language SHALL be independent of the provider's list order. When no rule yields an eligible track, the system SHALL save the video with its player and without captions.

#### Scenario: Automatic subtitles for original and dubbed audio

- **WHEN** the provider lists `a.ar`, `a.en`, and `a.zh-Hans` in any order
- **THEN** the system selects `a.zh-Hans` for a Chinese capture and `a.en` for an English capture

#### Scenario: Capture locale prefixes determine preference

- **WHEN** both Chinese and English automatic subtitles are available
- **THEN** a capture locale of `zh-Hant` prefers Chinese, and a capture locale of `en-US` or an empty locale prefers English

#### Scenario: English fallback for a Chinese capture

- **WHEN** the provider lists `a.ar` and `a.en` and the capture language is Chinese
- **THEN** the system selects `a.en` even when Arabic is listed first
- **AND** an available manual English track takes priority over the English automatic track

#### Scenario: Ambiguous foreign-language tracks

- **WHEN** a Chinese or English capture has multiple languages of automatic tracks or multiple languages of manual-only tracks, with no track in the preferred language or English
- **THEN** the saved video has a player and no captions

#### Scenario: Uploaded translations without an ASR track

- **WHEN** a video has manual tracks `ar`, `bn`, `nl`, and `en`, and the capture language is Chinese
- **THEN** the system selects the `en` track

#### Scenario: User language track exists

- **WHEN** a video has manual tracks `fr`, `zh-Hans`, and `en`, with no automatic tracks, and the capture language is Chinese
- **THEN** the system selects `zh-Hans`

#### Scenario: ASR track gives the original language

- **WHEN** a video has a Chinese manual track and one English automatic track, and the capture language is Chinese
- **THEN** the system selects the English automatic track

#### Scenario: Automatic tracks cover one language

- **WHEN** a video has a Chinese manual track and English automatic tracks that differ only by region
- **THEN** the system selects an English automatic track even for a Chinese capture
- **AND** a manual English track takes priority when present

#### Scenario: One available language outside Chinese and English

- **WHEN** the only available track is Japanese
- **THEN** the captured video keeps that Japanese track

## ADDED Requirements

### Requirement: Subtitle payload matches the capture selection

For an explicit caption request, the system SHALL reject a result whose reported video identity or base language conflicts with the requested video or selected track. An asynchronous response to the list request that returns subtitle content directly SHALL be eligible only if it reports the preferred Chinese or English language or the English fallback. The system SHALL require nonempty timed cues before saving a subtitle track. If an eligible track yields unusable content and another eligible track is known, the system SHALL allow one alternate content request within the existing caption acquisition time budget. Without a usable eligible response, the system SHALL retain the video player and save no captions.

#### Scenario: Provider returns the wrong language

- **WHEN** the selected English track returns a response labelled Arabic
- **THEN** the response is discarded
- **AND** the system attempts another eligible listed track if available within the time budget

#### Scenario: Asynchronous listing returns an unexpected language directly

- **WHEN** a Chinese or English capture receives only directly returned Arabic content from the asynchronous listing
- **THEN** the video is saved with its player and without captions

#### Scenario: No usable subtitle content

- **WHEN** the provider lists no tracks or eligible responses contain no usable timed cues
- **THEN** the video is saved with its player and without captions
