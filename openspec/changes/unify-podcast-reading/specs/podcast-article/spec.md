## ADDED Requirements

### Requirement: Consistent Podcast reading presentation

A ready Podcast bookmark SHALL show its playable episode before the readable article. Original and translated articles SHALL use the YouTube reading hierarchy.
The article SHALL contain a separately labeled introduction, contents, topic headings, paragraphs, timestamps, and source notes.
Contents SHALL be collapsible on narrow screens. Controls SHALL support keyboard use and touch targets of at least 44 pixels.

#### Scenario: Ready article on a phone
- **WHEN** a reader opens a ready Podcast bookmark at a width of 320 pixels
- **THEN** the player appears before readable paragraphs without horizontal overflow
- **AND** the contents can expand and navigate to a topic

#### Scenario: Timestamp playback
- **WHEN** the reader activates a paragraph timestamp by click, Enter, or Space
- **THEN** the episode player seeks to that paragraph and starts playback

#### Scenario: Translation layout
- **WHEN** a ready translation replaces the original article view
- **THEN** it retains the same reading hierarchy and paragraph playback references

### Requirement: Public platform episode resolution

With Podcast Labs enabled, supported public episode links SHALL enter the same Podcast processing flow after successful resolution.
Supported platforms SHALL include Apple Podcasts, Xiaoyuzhou, Pocket Casts, Spotify, Overcast, Castbox, Amazon Music, and Ximalaya.
Resolution SHALL require full public episode audio or a usable publisher transcript. A platform name or player embed alone SHALL NOT establish transcript availability.
Short links SHALL resolve through bounded, URL-checked redirects. Show pages SHALL NOT silently select a different episode.

#### Scenario: Compact Pocket Casts share link
- **WHEN** a compact Pocket Casts link resolves to a public episode
- **THEN** it resolves the same episode audio as that episode's canonical link

#### Scenario: Older Apple episode
- **WHEN** a saved Apple episode is outside the initial lookup window but has a verifiable public episode source
- **THEN** the system resolves that exact episode without substituting the newest episode

#### Scenario: Public audio from another platform
- **WHEN** a supported platform episode provides full public audio or an exact publisher feed item
- **THEN** the system uses the common transcript, editing, translation, and publication flow

#### Scenario: Restricted or preview-only episode
- **WHEN** the system cannot obtain full public episode audio or a usable publisher transcript
- **THEN** it preserves an available embed or source link and reports transcript unavailability
- **AND** it does not report episode notes, a preview, or an empty article as completed text

#### Scenario: Unsafe redirect
- **WHEN** a share link redirects to a blocked address or exceeds the redirect limit
- **THEN** the system stops resolution without requesting protected resources

### Requirement: Complete Podcast article editing

The system SHALL edit speech in its original language before translation. Editing SHALL preserve claims, questions, examples, numbers, qualifications, and order.
Every source cue SHALL map once to the edited paragraphs in source order. Excessive shortening or truncated output SHALL prevent publication.
The introduction SHALL use the complete edited article and remain distinct from the speech. Translation SHALL preserve paragraph structure and source references.

#### Scenario: Missing or reordered source passage
- **WHEN** edited output omits or reorders source references, or fails the source-length check
- **THEN** the system rejects the output before publication and preserves any previously saved article

#### Scenario: Topic near the end
- **WHEN** the source discusses a major topic near the end of a long episode
- **THEN** introduction generation receives that topic with the rest of the complete article

#### Scenario: Translation changes paragraph count
- **WHEN** translated output changes the required paragraph structure
- **THEN** the system rejects it without replacing the ready original article

### Requirement: Observable Podcast publication completion

The system SHALL distinguish canonical article generation from bookmark-body publication. A failed body write SHALL NOT report completed publication.
An authorized visitor SHALL read an already saved article without enabling generation. Disabled Labs SHALL NOT hide ready content.
Existing private access, moderation, owner-only retry, budget, and annotation protections SHALL remain effective.

#### Scenario: Failed body write
- **WHEN** article generation succeeds but bookmark-body publication fails
- **THEN** the system retains the generated article for retry and reports publication as incomplete

#### Scenario: Visitor opens saved content
- **WHEN** an authorized visitor opens a bookmark whose article body is saved
- **THEN** the visitor reads that body without starting paid generation, including when the owner disables Labs

#### Scenario: Annotated recapture
- **WHEN** owner recapture would replace a body with existing annotations
- **THEN** the system preserves that body and its annotations instead of silently replacing them


### Requirement: Verified alternate transcript source

The system SHALL inspect publisher transcripts and explicitly linked YouTube captions before paid audio transcription.
It SHALL preserve the transcript source URL and timeline. It SHALL NOT infer an episode match from its title alone.

#### Scenario: Official linked video captions
- **WHEN** episode metadata explicitly links its YouTube version and usable captions exist
- **THEN** the system can produce the article from those captions without paid audio transcription
- **AND** it identifies YouTube as the transcript source

#### Scenario: Different audio timing
- **WHEN** the article uses YouTube captions without verified Podcast timing
- **THEN** timestamp controls open the corresponding YouTube position instead of seeking the Podcast audio

#### Scenario: No usable captions
- **WHEN** a linked video has no usable captions but public episode audio exists
- **THEN** the existing audio transcription path remains available
