## ADDED Requirements

### Requirement: Known cover dimensions survive capture

The FxEmbed X article capture path SHALL preserve the validated positive intrinsic dimension pair for the exactly matched cover source before proxy rewriting when both dimension attributes are absent. It SHALL preserve authored dimensions, unrelated images, body text, identifiers and source order. No network dimension discovery or mutation of existing snapshots is required.

#### Scenario: Unsized matching cover
- **WHEN** FxEmbed supplies an exact cover source and valid positive width/height and the corresponding article image has neither dimension attribute
- **THEN** the saved image retains that intrinsic pair through proxy rewriting and article construction

#### Scenario: Missing metadata or authored sizing
- **WHEN** the pair is absent or invalid, the source does not match, or either dimension attribute is already authored
- **THEN** capture leaves the image's dimensions and existing layout intent unchanged
