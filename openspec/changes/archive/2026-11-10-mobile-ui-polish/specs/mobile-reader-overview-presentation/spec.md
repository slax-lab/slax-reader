## ADDED Requirements

### Requirement: Inline Overview prefix matches its content typography

The inline Overview excerpt at the top of the Reader SHALL render its localized prefix and summary content at the same 14-point base font size and line height, including system font scaling. The prefix SHALL retain its muted color. The excerpt SHALL preserve its three-line truncation, expansion action, and empty-content behavior; the expanded dialog's typography SHALL remain unchanged.

#### Scenario: An Overview excerpt is displayed
- **WHEN** a nonempty Overview excerpt appears in Chinese or English
- **THEN** its prefix matches the summary content's font size and line height
- **AND** tapping the excerpt still expands the Overview from its existing origin
