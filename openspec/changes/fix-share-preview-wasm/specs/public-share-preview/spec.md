## ADDED Requirements

### Requirement: A public article without images has a share preview

The Web Pages deployment SHALL provide a PNG preview generated from the article title when a public article has neither a cover nor an image in its body.

#### Scenario: A crawler fetches the fallback image

- **WHEN** a crawler requests the public article page and follows its Open Graph image URL
- **THEN** the article page returns HTTP 200 and supplies a dynamic image URL
- **AND** that URL returns HTTP 200 with a valid PNG.
