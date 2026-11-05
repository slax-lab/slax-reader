# snapshot-ai-text Specification

## Purpose
Keep AI input aligned with the readable saved HTML snapshot so copied articles support outline, overview, and chat without reacquiring external content.

## Requirements

### Requirement: Copied HTML retains usable AI text

The system SHALL derive AI text from the saved HTML being copied for both fragments and complete documents. Script, style, noscript, and embedded snapshot metadata content SHALL be excluded. Nonempty visible article text SHALL NOT become empty solely because the saved HTML lacks an explicit body or article element.

#### Scenario: Fragment without an article element
- **WHEN** a user Forks a readable HTML snapshot rooted in a div or containing sibling fragment elements
- **THEN** the saved destination retains its visible text and outline, overview, and chat receive that destination text under their existing eligibility rules

#### Scenario: Complete document or article fragment
- **WHEN** a user Forks a complete HTML document or an article-rooted fragment
- **THEN** the destination's AI text contains the saved article text without executable content or embedded metadata

### Requirement: Existing empty snapshot text remains recoverable

When an existing conventional HTML snapshot text object is empty, the system SHALL derive AI input from the matching destination HTML snapshot at read time. It SHALL retain existing authorization, moderation, subscription, and unavailable-content behavior, without consulting the original website, source owner's storage, or an AI provider to recover text. Nonempty text and PDF extraction semantics SHALL remain unchanged.

#### Scenario: Existing Fork has empty text
- **WHEN** an eligible owner requests outline, overview, or chat for an existing copy whose text object is empty but whose saved HTML contains readable text
- **THEN** the operation receives text derived from that same copy without requiring another Fork or a storage migration

#### Scenario: Source is no longer accessible
- **WHEN** the original shared source has been deleted or made private after copying
- **THEN** recovery still uses only the destination's saved HTML and existing destination access policy

#### Scenario: No readable destination content
- **WHEN** the destination text is empty and its matching HTML is missing or has no readable text
- **THEN** the existing unavailable-content outcome is retained and no model call is started

#### Scenario: Existing nonempty text and PDF
- **WHEN** AI reads a nonempty text object or an existing PDF snapshot
- **THEN** its existing text and extraction eligibility behavior are preserved
