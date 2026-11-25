# Spec Delta

## Purpose

Preserve source attribution in saved official WeChat articles captured through the legacy fallback.

## ADDED Requirements

### Requirement: Provide a default site name for legacy WeChat captures

When a legacy fallback capture of an official WeChat article succeeds, the API SHALL save the extracted site name if it contains non-whitespace characters. Otherwise, it SHALL save `微信` as the site name.

#### Scenario: Fallback article has an empty site name

- **WHEN** a new official WeChat article is captured successfully through the legacy fallback and its parsed site name is empty or whitespace
- **THEN** its stored `site_name` is `微信`
- **AND** the public Collection returns `微信` for that article once it is listed

#### Scenario: Fallback article supplies a site name

- **WHEN** an official WeChat article is captured successfully through the legacy fallback and parsing yields a nonblank site name
- **THEN** the stored `site_name` retains the parsed value
