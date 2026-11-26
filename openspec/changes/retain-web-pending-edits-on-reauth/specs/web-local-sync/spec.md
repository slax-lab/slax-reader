## ADDED Requirements

### Requirement: Recover pending library edits after session expiry

The Web experience SHALL when authentication interrupts a local upload, tell the reader that edits await sign-in. Resume that owner's pending changes on verified same-account return.

#### Scenario: Expired upload

- **WHEN** a reader renames a saved article and authentication expires before that write uploads
- **THEN** sign-in recovery explains that an edit awaits synchronization without exposing its contents on the signed-out screen

#### Scenario: Same owner returns

- **WHEN** the same account signs in after the interrupted upload
- **THEN** the new title returns, the pending change uploads, and a second session reads the new title

#### Scenario: Different owner returns

- **WHEN** another account signs in or the original reader explicitly signs out
- **THEN** the previous account's data and queue cannot appear or upload under the new identity
