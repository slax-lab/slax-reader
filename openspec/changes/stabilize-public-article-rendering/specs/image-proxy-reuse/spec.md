## ADDED Requirements

### Requirement: Eligible stored images populate the existing edge cache

After existing validation, an eligible successful non-Range R2 image hit SHALL enqueue population of the existing Cache API key without delaying or changing the returned image. Existing mode, signature, Referer, public-target, MIME and size rules SHALL remain in effect. Partial and video responses SHALL NOT be newly promoted into the image cache.

#### Scenario: Valid R2 image hit
- **WHEN** a valid signed image request misses the edge cache and hits an eligible R2 image
- **THEN** the original response and bytes are returned and a response clone populates the same signed edge cache key
- **AND** a subsequent request at the same data center can use that entry

#### Scenario: Invalid or partial media request
- **WHEN** a signature, Referer, MIME or RSS validation fails, or a request uses Range or a video response
- **THEN** its existing response/access behavior is retained and no new full-image cache entry is populated
