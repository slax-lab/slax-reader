# Spec Delta

## Purpose

Save the full body of an X Article when a user saves its status link, including posts whose introductory text accompanies the article link.

## ADDED Requirements

### Requirement: Article discovery permits introductory text

The system SHALL recognize article links on x.com and twitter.com in expanded tweet URL entities or tweet text, including when prose accompanies the link. It SHALL resolve t.co destinations only when an expanded destination is unavailable, with a bounded number of attempts. Unrelated URLs MUST NOT trigger article retrieval.

#### Scenario: Reported article with introductory text

- **WHEN** status `2100956349601624464` contains introductory text and a URL entity expanded to `https://x.com/i/article/2100948109664866305`
- **THEN** the system attempts full article retrieval instead of immediately saving the introductory tweet

#### Scenario: Missing URL entities

- **WHEN** tweet text contains an article URL or a t.co link resolving to an article alongside introductory text
- **THEN** the system recognizes the article without requiring the whole tweet to equal that URL

#### Scenario: Unrelated or misleading URL

- **WHEN** a tweet contains an ordinary website URL, an external URL with an article-shaped path, or a lookalike X hostname
- **THEN** the system retains ordinary tweet behavior

### Requirement: Article capture uses valid content and identifiers

The system SHALL prefer article content from the existing embed provider and fall back to the article API when the embed request fails or contains no usable article body. Requests to an API requiring a tweet ID MUST use a status ID and MUST NOT substitute an internal `/i/article/` ID. If neither provider yields usable content for a saved status, the system SHALL preserve the original tweet.

#### Scenario: Embed contains only preview metadata

- **WHEN** the embed provider returns HTTP 200 with metadata or a preview but no article body
- **THEN** the system attempts the article API with the associated status ID

#### Scenario: Provider fallback preserves the reported status ID

- **WHEN** the reported status references internal article ID `2100948109664866305` and embed retrieval fails
- **THEN** the article API receives tweet ID `2100956349601624464`

#### Scenario: Both providers are unavailable

- **WHEN** both article providers fail or return unusable content for a status
- **THEN** the original tweet, including its links and existing media behavior, can still be saved

#### Scenario: Direct internal article URL has no known status ID

- **WHEN** a direct `/i/article/` URL fails embed retrieval and no associated status ID is known
- **THEN** the system reports article retrieval failure without submitting the internal article ID as a tweet ID

### Requirement: Saved article content preserves the source

Successful capture SHALL persist the article body in both reader HTML and text used by downstream features. The bookmark SHALL retain the originally saved source URL.

#### Scenario: Full article captured through a status URL

- **WHEN** full article content is successfully retrieved for a saved status
- **THEN** its body is available in the reader and downstream text content, with the original status URL retained as the bookmark source
