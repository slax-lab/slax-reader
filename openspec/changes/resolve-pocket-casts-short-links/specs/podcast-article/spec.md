## ADDED Requirements

### Requirement: Pocket Casts short-code resolution

The system SHALL resolve public `pca.st` share redirects before deciding whether a link identifies a podcast episode.
For a resolved episode and an owner with podcast Labs enabled, capture SHALL use the existing podcast capture process.
The system SHALL preserve outbound URL validation, episode identity, and annotation protection.
Show links and unresolved short codes SHALL retain normal page handling.

#### Scenario: Reported short-code episode
- **WHEN** an owner with podcast Labs enabled saves `https://pca.st/6rpkp8cj` and it redirects to its canonical episode page
- **THEN** the bookmark receives the episode player and notes through podcast capture
- **AND** the existing transcription process receives the episode

#### Scenario: Same episode through different links
- **WHEN** the short-code link and the canonical episode link resolve to the same episode audio
- **THEN** both captures use the same episode source identity

#### Scenario: Show destination
- **WHEN** a `pca.st` share link redirects to a show page
- **THEN** the system handles it as a normal page without starting podcast transcription

#### Scenario: Labs disabled
- **WHEN** an owner without podcast Labs saves a short-code episode link
- **THEN** the system handles it as a normal page without starting podcast transcription

#### Scenario: Resolution unavailable
- **WHEN** short-code resolution fails or returns no redirect destination
- **THEN** the system retains normal page handling for the original link
- **AND** the unresolved short code does not qualify as an episode

#### Scenario: Unsafe redirect destination
- **WHEN** a short-code response redirects to a destination rejected by outbound URL validation
- **THEN** the system does not fetch the rejected destination or start transcription from it

#### Scenario: Existing annotated bookmark
- **WHEN** an owner requests recapture of a short-code episode bookmark with an existing annotated body
- **THEN** the system preserves the body and annotations without fetching the episode page

#### Scenario: Existing unannotated bookmark
- **WHEN** an owner with podcast Labs requests recapture of an unannotated short-code episode bookmark
- **THEN** podcast capture retains the bookmark identity

### Requirement: Concurrent readable podcast articles

The system SHALL edit complete podcast transcripts into readable articles through the existing article workflow.
It SHALL process at most five editing or translation chunks concurrently and assemble them in source order.
It SHALL retain cue references, quality checks, retry reuse, and the episode cost limit.

#### Scenario: Independent chunks
- **WHEN** an article requires multiple chunks
- **THEN** up to five model requests can run together without waiting for earlier generated text
- **AND** the final article follows source order and retains transcript coverage

#### Scenario: Concurrent cost admission
- **WHEN** model requests overlap
- **THEN** admission includes settled costs and active reservations
- **AND** a request waits for reservations or fails before spending beyond the available budget

#### Scenario: Failed chunk
- **WHEN** a chunk fails while sibling chunks are active
- **THEN** the workflow waits for the active siblings before ending the attempt
- **AND** a retry reuses successfully stored chunks

#### Scenario: Accounting failure
- **WHEN** a model cost cannot be recorded
- **THEN** the workflow admits no further model requests in that attempt
