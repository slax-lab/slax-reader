## ADDED Requirements

### Requirement: Annotated podcast recapture

When an owner saves a recognized podcast link again with podcast Labs enabled, the system SHALL check for highlights and comments on the existing body before it fetches the page. An annotated body SHALL be kept. This SHALL apply to every recognized podcast source.

#### Scenario: Annotated page capture of a non-Pocket Casts episode
- **WHEN** an owner saves a Xiaoyuzhou, Apple Podcasts, Spotify, or RSS episode link again, and its existing body has highlights or comments
- **THEN** capture ends without a page fetch, keeps the body and annotations, and leaves the bookmark readable

#### Scenario: Unannotated recapture
- **WHEN** the existing body has no highlights or comments
- **THEN** the system captures the episode as usual

#### Scenario: Labs disabled
- **WHEN** podcast Labs is disabled for the owner
- **THEN** the system saves the link as a page and does not check annotations
