## ADDED Requirements

### Requirement: Offer an existing tag when only letter case differs

The Web experience SHALL match existing tag candidates case-insensitively and preserve their display spelling. Prefer attaching an existing tag over creating a case variant.

#### Scenario: Existing tag differs only by case

- **WHEN** Rust exists and a reader types rust
- **THEN** Rust remains selectable and a create-rust action is absent

#### Scenario: Historical variants

- **WHEN** Rust and RUST already exist and the reader enters a case-equivalent query
- **THEN** both existing identities can be distinguished and selected, and neither is implicitly merged or newly created

#### Scenario: New name

- **WHEN** no available tag matches the entered name ignoring case
- **THEN** creation remains available with the spelling the reader supplied
