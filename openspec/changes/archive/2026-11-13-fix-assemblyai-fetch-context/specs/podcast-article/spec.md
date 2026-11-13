## MODIFIED Requirements

### Requirement: Transcript source and billing

The system SHALL use a publisher transcript when one exists, and SHALL otherwise transcribe the audio URL with AssemblyAI. A retried step SHALL NOT start a second paid transcription for the same episode.

#### Scenario: Publisher transcript
- **WHEN** the feed item has a VTT, SRT, Podcasting 2.0 JSON or timed text transcript
- **THEN** the system uses it and does not call AssemblyAI

#### Scenario: Retry that polls a counted job
- **WHEN** a later attempt polls a finished job whose cost was already counted
- **THEN** the episode cost and the site-wide spend do not change

#### Scenario: Retry after a stored job
- **WHEN** a workflow step retries after the provider job id was stored
- **THEN** the step polls the stored job and does not submit a new one

#### Scenario: Audio transcription on the Workers runtime
- **WHEN** an episode has no publisher transcript and the API runs on the Workers runtime
- **THEN** the system submits the audio URL to AssemblyAI instead of failing with an invalid fetch invocation
