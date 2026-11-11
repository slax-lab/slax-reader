# vector-image-input-validation Specification

## Purpose
Keep empty stored image objects out of embedding requests while preserving valid article content and explicit no-content failures.

## Requirements

### Requirement: Empty stored images are excluded from embedding inputs

The system SHALL skip stored images with zero reported bytes or an empty retrieved body, record the existing image-selection skip reason `empty`, and MUST NOT send an empty image value to the embedding provider. Skipped empty images SHALL NOT consume the valid-image selection allowance. Existing lookup limits and other selection checks SHALL remain unchanged.

#### Scenario: Storage reports an empty image
- **WHEN** an otherwise eligible image has a reported size of zero
- **THEN** it is counted as skipped with reason `empty` without reading its body or submitting it for embedding

#### Scenario: Retrieved bytes are empty
- **WHEN** a candidate with a positive reported size returns an empty body
- **THEN** it is counted as skipped with reason `empty` and no empty image input is emitted

#### Scenario: Valid content follows empty candidates
- **WHEN** an article contains valid text or later valid images alongside empty image objects
- **THEN** the valid content remains eligible for processing and empty candidates do not consume the four-image selection allowance

### Requirement: Empty-image filtering preserves truthful content outcomes

An article with no usable text or image SHALL retain the existing `missing_source_content` failure rather than report successful empty output. Filtering MUST NOT refetch source URLs, alter stored objects, swallow unrelated provider failures, or change embedding parameters.

#### Scenario: Only empty images remain
- **WHEN** an article has no usable text and all candidate images are empty
- **THEN** processing fails explicitly with `missing_source_content`

#### Scenario: A genuine provider error occurs
- **WHEN** a valid nonempty input is rejected by the provider
- **THEN** that provider failure remains observable rather than being treated as an empty-image skip
