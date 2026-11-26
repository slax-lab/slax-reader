## Purpose

Help readers reach library search, identify the active result set and keep recent terms private to the current account.

## ADDED Requirements

### Requirement: Keep search results attached to the active query

The Web experience SHALL keep rows, count, loading and errors tied to the latest search. Provide an in-place retry for the current input.

#### Scenario: Reordered success

- **WHEN** Rust starts before JavaScript but resolves after JavaScript succeeds
- **THEN** the heading, count and rows continue to describe JavaScript

#### Scenario: Latest search fails

- **WHEN** Images fails after a successful Rust search
- **THEN** the Images input remains editable, Rust rows and count disappear, and retry runs Images

#### Scenario: Stale failure and empty success

- **WHEN** an earlier request fails after a later search successfully returns zero matches
- **THEN** the empty state belongs to the latest search and no stale error or spinner replaces it
