# Discovery plaza

## Purpose

Give Web readers a place to discover recommended public Collections and read the articles those Collections contain.

## ADDED Requirements

### Requirement: Web Labs provides access to Discover

The Web application SHALL offer Discover as a per-account Labs setting and SHALL require a signed-in reader with that setting enabled to display the Discover page's recommendations.

#### Scenario: Reader opens Discover

- **WHEN** a reader enables Discover in Labs
- **THEN** the reader can open Discover from settings or the library sidebar.

#### Scenario: Reader opens a direct link with the Lab disabled

- **WHEN** a signed-in reader opens Discover with the setting disabled
- **THEN** the page provides a link to Labs and makes no request for recommendations.

### Requirement: Collections and stories retain their recommendation context

Discover SHALL lead with its recommended Collections and display readable member titles directly below each Collection. The feed below any featured topic SHALL preserve the relative recommendation order within the grouped and single-member sections.

#### Scenario: The reader explores a populated response

- **WHEN** multiple recommended Collections contain two or more readable members
- **THEN** the first screen shows recommended Collections with two or three member links under each name. The default first two cards and their leads follow the backend response. Choosing a topic features its matching stories.
- **AND** selecting the Collection name opens its existing public page and selecting a member opens its existing reading page.

#### Scenario: The reader scrolls for more recommendations

- **WHEN** additional recommended Collections are available beyond the initial viewport
- **THEN** scrolling reveals them without a manual reveal action.
- **AND** Collections with exactly one preview remain available as individual reading choices with links to their originating Collections.

#### Scenario: A member has limited display metadata

- **WHEN** the member has a publisher site or article description
- **THEN** the page can show the publisher and a short excerpt.
- **AND** a member without those fields remains readable using its title or URL and originating Collection.

### Requirement: Readers can follow a topic across Collections

Discover SHALL offer topics supported by different article URLs from at least two recommended multi-member Collections. The reader SHALL be able to choose among available topics and browse all returned Collections.

#### Scenario: Change the topic or pair

- **WHEN** a reader selects an available topic
- **THEN** Discover highlights matching stories from two distinct Collections and identifies how many recommended Collections cover the topic.
- **AND** when further Collections cover that topic the reader can advance to another pair.
- **AND** each featured Collection appears once on the page and its sibling articles retain their original links.

#### Scenario: No cross-Collection topic is available

- **WHEN** the titles supply no qualifying topic
- **THEN** Discover presents the available recommendations directly.

### Requirement: Discover requests interest-ranked members from recommended Collections

The existing Collection recommendation interface SHALL support an opt-in Discover representation. The service SHALL scope member ranking to eligible Collections selected through existing Collection recall and diversification.

#### Scenario: Rank articles within a Collection

- **WHEN** Discover requests recommendations for a reader with usable preferences
- **THEN** the service considers up to twelve recent eligible members per Collection and selects up to three distinct URLs, using the reader's saved-article preference and a bounded publication-age discount before selecting diverse members.
- **AND** saved or withdrawn members are excluded. Remaining slots can use eligible articles with unavailable vectors only if they were published within 30 days. A measured nonpositive article match is ineligible.
- **AND** the displayed reason distinguishes matches to saved articles from matches to subscriptions.

#### Scenario: Article history is unavailable

- **WHEN** a reader has a usable subscription-based Collection preference and lacks a saved-article preference
- **THEN** the service can select similar members using the subscription preference and label their origin accordingly.

#### Scenario: Freshness distinguishes equally relevant members

- **WHEN** two eligible members have equal positive affinity and different valid publication times
- **THEN** the more recently published member has the higher relevance score before diversification.
- **AND** the initial publication-age multiplier can discount positive affinity by at most ten percent before the subsequent card presentation pass.

#### Scenario: Old articles are starred again

- **WHEN** a Collection stars an article whose stored publication time is over 180 days old, missing, or in the future
- **THEN** the article is excluded before applying the twelve-member limit and cannot return as a lead, companion or replacement.
- **AND** an earlier valid WeChat source minute is used to recheck article age and to score the article.
- **AND** a matched article aged between 30 and 180 days receives an additional age discount increasing to twenty percent.

#### Scenario: A newly captured YouTube video or Substack post has an original publication date

- **WHEN** the watch page identifies the video and supplies a publication or upload timestamp, or the Substack article supplies its original publication timestamp
- **THEN** the saved bookmark records that source timestamp and Discover evaluates the usual age window against it.
- **AND** publication metadata remains associated with the original video or post across repeated captures.

#### Scenario: Existing representations

- **WHEN** an existing client requests the default Collection representation
- **THEN** it continues to receive recent member previews.
- **AND** the Lab can present a deployed response without a member-level interest reason.

### Requirement: Discover presents recommendation outcomes truthfully

Discover SHALL distinguish a missing preference, an empty set of eligible candidates and a failed request.

#### Scenario: Reader has no usable Collection preference

- **WHEN** the recommendation interface returns an empty list with `cold_start`
- **THEN** Discover explains how following Collections informs recommendations and links to the reader's Collections.

#### Scenario: No eligible candidates

- **WHEN** the request succeeds with no eligible Collections
- **THEN** Discover displays its empty state.

#### Scenario: Request fails

- **WHEN** a request fails
- **THEN** the page reports a loading error and lets the reader retry.


### Requirement: Discover ranks complete cards for the default screen

The Discover representation SHALL select cards using both Collection affinity and the articles available to display. It SHALL keep each story once across all cards, use eligible reserves when a story was placed earlier, and return the lead first. A prior-year forecast or aging release announcement MAY receive an additional, bounded discount using publication time. Other clients SHALL keep their existing recommendation representation.

#### Scenario: A high-affinity lead also belongs to another Collection

- **WHEN** an earlier card displays a story that a later candidate would have featured
- **THEN** the service removes that story from the later card, fills from its remaining eligible members and evaluates the card using its actual lead and companions
- **AND** the page displays the service-selected cards and leads unless the reader explicitly chooses a topic.

#### Scenario: A time-bound story has expired

- **WHEN** an explicit forecast's target year has elapsed
- **THEN** its presentation priority and contribution to the card receive an extra discount
- **AND** a retrospective referring to the same year keeps the ordinary publication-age treatment.

### Requirement: Editorial Discover on Web and Mobile

Discover SHALL emphasize the first recommended lead and give its companion stories directly readable links. On wide Web screens the second featured Collection SHALL sit alongside the first. On phones the cards SHALL stack in reading order. Web SHALL group Discover under new Labs features in the library sidebar. The signed-in Mobile application SHALL offer a Discover page from its library and use its authenticated recommendation service.

#### Scenario: Open Discover on a phone

- **WHEN** a signed-in reader opens Discover from the App library
- **THEN** the screen requests the Discover representation, preserves the backend card and member order, and opens the corresponding public Collection or bookmark on selection.
- **AND** cold start, empty results and retryable failures are distinguishable.

#### Scenario: Discover the Web experiment

- **WHEN** the service lists the Discover experiment for a Web reader
- **THEN** the sidebar displays Discover in the Labs group, and the page requires the account switch before fetching recommendations.
