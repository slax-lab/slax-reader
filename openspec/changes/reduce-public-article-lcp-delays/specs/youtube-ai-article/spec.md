## ADDED Requirements

### Requirement: Saved edited article player geometry remains stable during enhancement

The Web reader SHALL keep the native fallback and enhanced player of a saved edited YouTube article in the same effective responsive box, including height and vertical spacing. It SHALL preserve the existing final appearance, complete initial article, native fallback and media/annotation behavior. This SHALL apply to existing saved articles without recapture or stored-content changes.

#### Scenario: Existing saved article is opened
- **WHEN** a reader opens an existing saved body containing an edited YouTube article and the player is enhanced
- **THEN** enhancement retains the player's effective outer box and the following introduction's position under otherwise unchanged layout
- **AND** the complete introduction, paragraphs, headings, cue data and annotation targets remain present

#### Scenario: Enhancement is delayed or unavailable
- **WHEN** client enhancement is delayed or unavailable on that saved edited article
- **THEN** the native player fallback and initial article remain usable in the same responsive reading layout
- **AND** article text is not hidden, truncated or deferred to improve the reported performance metric

#### Scenario: Reader interacts after enhancement
- **WHEN** the reader uses chapter controls, the transcript panel, contents links, existing highlights or player controls
- **THEN** those actions retain their existing target, playback and navigation behavior without regeneration or stored-body rewriting

#### Scenario: Another reading presentation is opened
- **WHEN** the reader opens a raw YouTube transcript, an edited article shown separately below an annotated transcript, a podcast or an ordinary article
- **THEN** that presentation's existing player, typography, controls, image preview and layout remain unchanged
