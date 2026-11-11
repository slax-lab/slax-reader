## ADDED Requirements

### Requirement: Rejected optional images do not discard usable article content

Provider-confirmed image decoding, unsupported aspect ratio and image byte/pixel-limit failures SHALL skip the offending optional image and preserve usable text and other images, with a fixed safe skip category. Unrelated HTTP 400 responses, invalid text, authentication, throttling, network failures, provider server failures and invalid provider output SHALL NOT be swallowed as image skips. If all substantive inputs fail or are absent, the article SHALL remain explicitly unavailable.

#### Scenario: Image aspect ratio is unsupported
- **WHEN** the provider rejects one image because of its aspect ratio
- **THEN** the image is skipped and article text and later eligible images remain processable

#### Scenario: Image decoding or pixel count fails
- **WHEN** an image cannot decode or exceeds the provider pixel-decode limit
- **THEN** that image is isolated without source mutation or discarding successful text

#### Scenario: Provider service fails
- **WHEN** a request fails because of authorization, rate limiting, transport or server availability
- **THEN** the operational failure remains visible and retryable rather than counted as an unusable image


## MODIFIED Requirements

### Requirement: Empty-image filtering preserves truthful content outcomes

An article with no usable text or image SHALL retain the existing `missing_source_content` failure rather than report successful empty output. Filtering MUST NOT refetch source URLs, alter stored objects, swallow operational provider failures or unrelated input rejections, or change embedding parameters.

#### Scenario: Only empty images remain
- **WHEN** an article has no usable text and all candidate images are empty
- **THEN** processing fails explicitly with `missing_source_content`

#### Scenario: A genuine provider error occurs
- **WHEN** a valid nonempty input receives an operational provider error or an input rejection outside the explicitly recognized optional-image categories
- **THEN** that provider failure remains observable rather than being treated as an empty-image skip
