# Offer an existing tag when only letter case differs

## Context

BookmarkTags uses case-sensitive equality, so typing rust can offer creation even when Rust is already available.

## Goals / Non-Goals

Match existing tag candidates case-insensitively and preserve their display spelling. Prefer attaching an existing tag over creating a case variant.

## Decisions

Compare normalized input with candidate display names at search and creation time. Preserve stable IDs. Where legacy case variants coexist, list them as separate selectable records and require an explicit selection rather than choosing one arbitrarily or merging historical data.

## Risks / Trade-offs

Sequence after clarify-web-tag-confirmation for bookmark-tag-presentation.

## Verification

Use the affected Web entry point in a running browser and record the observed result for each scenario.
