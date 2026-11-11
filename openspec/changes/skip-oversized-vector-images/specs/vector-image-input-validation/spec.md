## ADDED Requirements

### Requirement: Oversized stored images are excluded independently

The system SHALL exclude an individual stored article image when its raw size exceeds 5,242,880 bytes, recording the image-selection skip reason `image_too_large`. When stored metadata already reports an excessive size, the system SHALL skip the image without retrieving its body. Retrieved image bytes exceeding the same limit SHALL NOT be encoded or submitted to the embedding provider. An image exactly at the limit SHALL remain eligible subject to all other existing selection checks.

Skipped oversized images SHALL NOT consume the four-image selection allowance or prevent usable text and later eligible images from being processed. The existing candidate lookup bound and overall request-byte bound SHALL remain in effect. Filtering SHALL NOT modify stored objects, refetch source URLs, compress images, or suppress unrelated provider errors. If no usable text or image remains, processing SHALL retain the explicit `missing_source_content` outcome.

#### Scenario: Metadata exceeds the provider image limit
- **WHEN** an otherwise eligible stored image reports 5,242,881 bytes or more
- **THEN** it is skipped with reason `image_too_large` without downloading its body or submitting an embedding request for it

#### Scenario: Retrieved image exceeds the provider image limit
- **WHEN** stored metadata passes the size check but the retrieved image contains more than 5,242,880 bytes
- **THEN** the image is skipped with reason `image_too_large` before encoding or provider submission

#### Scenario: Image is exactly at the size boundary
- **WHEN** an otherwise eligible image contains exactly 5,242,880 bytes and fits the existing request-byte budget
- **THEN** it remains eligible for embedding

#### Scenario: Valid content follows an oversized image
- **WHEN** an article contains text and eligible images alongside one or more oversized images
- **THEN** the text and eligible images remain eligible for embedding and skipped oversized images do not consume the four valid-image slots

#### Scenario: Only oversized images remain
- **WHEN** an article has no usable text and all candidate images exceed the size limit
- **THEN** processing fails explicitly with `missing_source_content` instead of reporting successful empty output

#### Scenario: An eligible input receives another provider error
- **WHEN** an eligible input is rejected by the provider for a reason other than the local oversized-image filtering rule
- **THEN** the existing failure remains observable rather than being swallowed as an oversized-image skip
