# Spec Delta

## Purpose

Deliver authorized public article pages with promptly readable first-screen content and bounded startup work while preserving the complete saved article and its existing reading functions.

## ADDED Requirements

### Requirement: Browser delivery preserves the canonical snapshot

The deployed Web article response SHALL omit the server-side embedded snapshot manifest when it has no Web runtime consumer. It SHALL retain the complete visible article, source order, heading identifiers, selection anchors and attributes needed by existing media playback. Canonical stored HTML, text, manifests, translations and fork data SHALL remain unchanged. Initial document rendering, hydration, same-origin content refresh and client navigation SHALL agree on the projected body.

#### Scenario: Podcast carries an embedded snapshot manifest
- **WHEN** an authorized Web reader opens a podcast with the embedded server manifest
- **THEN** the response excludes that manifest without removing the visible transcript or required playback data
- **AND** translation, subtitles and snapshot-fork operations retain their existing content and access behavior

#### Scenario: Article is refreshed after hydration
- **WHEN** the same article body is restored during hydration or fetched again through the Web content endpoint
- **THEN** the reader retains the same visible body and anchors without a full-body replacement caused by projection disagreement

### Requirement: Fresh access and presentation decisions precede cached delivery

Every public article response, including a warm HTML-cache hit, SHALL preserve current authorization, sharing revocation, deletion, moderation and presentation-privacy decisions. Credentialed responses SHALL retain their existing private isolation. A successful authorized metadata result reused during the same request SHALL remain bound to that article and credential state; denied or failed results SHALL NOT become authorization grants or cross-request cached data.

#### Scenario: Share is revoked after HTML is cached
- **WHEN** a visitor requests a warmed article after its share is disabled
- **THEN** the response denies access according to the existing snapshot rule instead of serving the cached article

#### Scenario: Cached presentation is outdated
- **WHEN** current authorized metadata differs from the warmed presentation revision
- **THEN** the response reflects the current authorized presentation
- **AND** any metadata reuse does not change its title, author privacy, visible marks or body identity

#### Scenario: Credentials are present
- **WHEN** a request includes a session cookie or authorization header
- **THEN** its response cannot use an anonymous metadata shortcut or be published as anonymous cached HTML

### Requirement: Readable first paint is independent of optional enhancements

The article's existing first-screen text and eligible images SHALL be present in the initial HTML and SHALL remain visible while optional media or annotation enhancements initialize. Enhancements SHALL preserve reading order, deep links, image previews, highlights, comments, find-in-page and accessibility. The system SHALL NOT hide, truncate or postpone visible article content until interaction to improve reported LCP.

#### Scenario: Optional enhancement is slow
- **WHEN** media initialization or nonessential annotation work is delayed
- **THEN** the existing first-screen article remains readable with usable ordinary links
- **AND** later enhancement does not replace selection anchors or introduce a new layout shift

### Requirement: Podcast enhancement avoids redundant preload when duration is supplied

For an episode with a supplied positive duration, upgrading the native podcast player SHALL preserve its no-preload behavior until explicit playback or seeking intent. Episodes with an absent or zero supplied duration SHALL retain existing metadata loading so duration and progress controls initialize. Supplied duration SHALL remain visible before media metadata loads. Playback, timed paragraph seeking, progress seeking, resume position, speed and media-session controls SHALL retain their current behavior, including intent received before metadata is available.

#### Scenario: Reader opens a podcast without playing
- **WHEN** a podcast with a supplied positive duration first renders and its custom controls initialize
- **THEN** the upgrade does not start an audio-body or audio-metadata transfer solely because it mounted
- **AND** the article and supplied duration remain available

#### Scenario: Reader seeks before metadata loads
- **WHEN** the reader selects a timed paragraph before audio metadata is available
- **THEN** the player retains user-gesture authorization, loads the media, applies that requested time when possible and plays from that intent without another gesture
- **AND** a restored position cannot overwrite the explicit seek

#### Scenario: Saved duration is unknown or differs from media metadata
- **WHEN** an episode has no supplied positive duration
- **THEN** existing metadata preload initializes its duration and seek range
- **AND** when real metadata arrives, an out-of-range restored position is discarded while an explicit seek retains precedence

### Requirement: Field outcome is assessed for both article families

Release evidence SHALL assess LCP Good of at least 70% separately for frozen public podcast and X long-form article cohorts over seven complete days after build/cache convergence, with at least 200 reported LCP counts per family. It SHALL retain the two reported URLs as explicit canaries, report their Good rates with counts and require at least 100 reported counts before judging either canary. An adequately sampled reported canary below 70% SHALL remain an unresolved target failure for its family, and an unjudged canary SHALL keep the overall result inconclusive. Rates SHALL use summed Good and total counts rather than averages of URL percentages. Browser/device/region mix, count sampling/estimation limits, build identity and meaningful functional/INP/CLS regressions SHALL accompany the result. A raw-rate pass caused only by traffic-mix change SHALL NOT establish optimization success; the matched-mix rate SHALL also reach 70%. Insufficient, unmatchable or mixed-build samples SHALL be reported as inconclusive.

#### Scenario: Combined average reaches the target but one family fails
- **WHEN** a combined article average exceeds 70% while an adequately sampled family or reported canary remains below 70%
- **THEN** the evidence does not declare the overall optimization target achieved

#### Scenario: Observation volume is insufficient
- **WHEN** either family has fewer than 200 reported LCP counts or a reported canary has fewer than 100 in the seven-day window
- **THEN** observation continues and that family's result remains inconclusive
- **AND** faster collections, login pages or unrelated article types do not fill its denominator

#### Scenario: Only the audience mix improves
- **WHEN** the raw family rate reaches 70% but its matched-mix rate does not
- **THEN** evidence reports the observed raw rate without declaring the optimization target achieved
