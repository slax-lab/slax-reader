## Purpose

Help readers correct import selections and understand the progress and outcome of an import job.

## ADDED Requirements

### Requirement: Explain an unsupported import file type

The Web experience SHALL name the unsupported format and list the selected importer's accepted types. Keep the file picker available for immediate correction.

#### Scenario: Wrong extension

- **WHEN** a reader selects notes.txt for Pinboard
- **THEN** the page names the unsupported type, lists JSON, HTML/HTM and XML, and can reopen the picker

#### Scenario: Corrected selection

- **WHEN** a supported valid export is chosen immediately afterward
- **THEN** the format error clears and the preview opens

#### Scenario: Cancelled selection

- **WHEN** the picker is closed without choosing a file
- **THEN** no format or missing-file error is added
