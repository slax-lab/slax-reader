## ADDED Requirements

### Requirement: Honor supplied WeChat and X publisher snapshots

The API SHALL use supplied nonblank HTML for a fresh WeChat or X capture by an allowlisted publisher. It SHALL persist safe article or tweet markup, supplied attribution and the original publication time when present without calling the platform provider, and retain normal moderation.

#### Scenario: Publisher submits a captured post

- **WHEN** a publisher saves a WeChat post, X status or X article with HTML
- **THEN** Reader uses that body, including safe images, quotations and source metadata, without fetching another copy

#### Scenario: Normal platform capture

- **WHEN** the saving account is not allowlisted or no HTML is supplied
- **THEN** the existing platform capture path remains in use

#### Scenario: Publisher submits a preformatted ordinary article

- **WHEN** an allowlisted publisher submits a regular non-PDF article document explicitly marked as publisher article HTML
- **THEN** Reader stores the supplied article and metadata without probing the source URL for a PDF

#### Scenario: Other social sources submit articles explicitly

- **WHEN** a publisher submits marked article HTML for another social source such as Weibo
- **THEN** Reader captures the supplied article using ordinary article markup without calling its platform provider
- **AND** dedicated video, podcast and file acquisition remains available for those media
