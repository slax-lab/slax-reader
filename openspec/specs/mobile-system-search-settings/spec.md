# mobile-system-search-settings Specification

## Purpose
Defines readable presentation of system-search availability in Mobile Settings, including iOS versions that cannot publish Spotlight entries.

## Requirements

### Requirement: Unavailable system-search guidance stays within its card

When system actions are available but Spotlight indexing is unavailable, Mobile Settings SHALL show the complete localized system-search title and iOS requirement message within the card's content bounds. The requirement message SHALL appear below the title, wrap naturally, and remain readable without truncation or horizontal scrolling on narrow supported iPhone screens and with enlarged system text. Card height SHALL accommodate the text.

#### Scenario: Unsupported indexing on a narrow iPhone

- **WHEN** a user opens Settings on iOS 16.4 or 17 with a 320-point or 375-point viewport in Chinese or English
- **THEN** the system-search title and full iOS 18 requirement message remain inside the card
- **AND** the requirement message wraps below the title as needed

#### Scenario: Enlarged text

- **WHEN** the user enlarges system text and opens the unsupported system-search setting
- **THEN** the complete title and requirement message remain readable within the card without overlap or clipping

#### Scenario: Supported indexing

- **WHEN** Spotlight indexing is available
- **THEN** Settings retains its system-search switch with the existing label, persisted value, and change action
- **AND** the unavailable message is absent

#### Scenario: Independent donation controls

- **WHEN** Spotlight indexing is unavailable but system actions are available
- **THEN** donation controls retain their existing availability and independent preference behavior
