# Spec Delta

## ADDED Requirements

### Requirement: Public Collection displays the saved host when the site name is empty

The public Collection response SHALL include each listed bookmark's saved host as `host_url`. The Web Collection article source label SHALL display the bookmark's nonblank `site_name` when available and otherwise display its nonblank `host_url`.

#### Scenario: Existing bookmark has a host but no site name

- **WHEN** a public Collection lists a bookmark with an empty or whitespace-only site name and a saved host
- **THEN** the article source label displays the saved host

#### Scenario: Bookmark has a site name and host

- **WHEN** a public Collection lists a bookmark with both a nonblank site name and host
- **THEN** the article source label displays the site name

#### Scenario: Bookmark has no source metadata

- **WHEN** a public Collection lists a bookmark with neither a nonblank site name nor a nonblank host
- **THEN** the article source label is absent
