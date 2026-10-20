# Spec Delta

## Purpose

Report Content Validation outcomes to the operations group with a concise card that keeps the signals operators act on.

## ADDED Requirements

### Requirement: Concise validation result card

The Content Validation result card SHALL contain the bookmark title, URL, AI issue type, AI description, and a one-line parse quality summary. It SHALL NOT include the AI confidence, the AI evidence list, or a screenshot preview link.

#### Scenario: Validation completes without issues

- **WHEN** AI validation completes and reports issue type `none`
- **THEN** the card contains the title, URL, `none`, the AI description, and the one-line parse quality summary

#### Scenario: Validation finds an issue

- **WHEN** AI validation reports an issue with high confidence
- **THEN** the card contains the same five fields and reports the issue type and AI description

### Requirement: One-line parse quality summary

The parse quality summary SHALL show the overall completeness percentage and, when a parser was selected, the parser name in the format `综合完整度 <percent>% （来自<parser>）`. When no score is available, the card SHALL keep the existing unavailable-score explanation instead.

#### Scenario: Scored parse quality

- **WHEN** the quality review has a score and a selected parser
- **THEN** the summary shows `综合完整度 <percent>% （来自<parser>）`

#### Scenario: Score unavailable

- **WHEN** the quality review has no comparable source HTML or no score
- **THEN** the summary shows the existing unavailable-score explanation
