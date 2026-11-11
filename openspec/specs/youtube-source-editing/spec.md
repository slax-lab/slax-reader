# youtube-source-editing Specification

## Purpose
Defines how YouTube subtitle translation generates, accepts, repairs and publishes target-language text from source-owned passages.

## Requirements

### Requirement: Source-owned generation and acceptance

The service SHALL bind every cleaned subtitle to exactly one ordered passage, generate target-language text directly from its source, and accept each passage only after source-aware checks. Speakers and seek references SHALL be program-owned. Same-language editing SHALL retain source wording when unavailable or unfaithful.

#### Scenario: Direct translation
- **WHEN** the caption language differs from the target
- **THEN** generate the translation directly without a mandatory source-edit call

#### Scenario: Partial or invalid response
- **WHEN** a batch omits passages or returns invalid language, numbers, length or duplicate content
- **THEN** persist accepted passages and repair only rejected passages with their rejection reasons

### Requirement: Bounded resumable repair

The service SHALL persist accepted results and repair state within the existing chunk prefix, bound content repairs and request costs, and estimate remaining work from unresolved passages.

#### Scenario: Interrupted generation
- **WHEN** a transport failure or process restart interrupts generation
- **THEN** reuse accepted results and request only outstanding work with the existing backoff and spend limits

#### Scenario: Truncated passage
- **WHEN** a single-passage request truncates and sentence boundaries permit a smaller request
- **THEN** persist bounded child work and join successful children in source order under the original references

#### Scenario: Repeated content failure or exhausted budget
- **WHEN** required translation remains unaccepted and the content repair allowance or spend cap is exhausted
- **THEN** stop with an explicit error and retain accepted progress

#### Scenario: Same-language editing has no remaining model budget
- **WHEN** the source already matches the target language and request admission rejects optional editing because the run or lifetime budget is exhausted
- **THEN** retain accepted edits, use cleaned source wording for outstanding passages, and publish only after the complete body passes acceptance without further model spend
- **AND** storage, ownership and accounting failures still stop publication

### Requirement: Complete publication with presentation fallbacks

The service SHALL publish only complete accepted target-language content with valid references. Missing or unavailable headings and introductions SHALL use extracts of accepted text. Publication SHALL still respect ownership, storage and accounting failures.

#### Scenario: Introduction failure
- **WHEN** all body passages are accepted but introduction generation fails
- **THEN** use an extractive introduction and publish the accepted body

#### Scenario: Localized assembly failure
- **WHEN** final validation identifies invalid passages
- **THEN** repair only those passages and preserve the accepted remainder

#### Scenario: Structural assembly failure
- **WHEN** a failure cannot safely be localized or repair is exhausted
- **THEN** retain progress and report failure instead of deleting completed work
