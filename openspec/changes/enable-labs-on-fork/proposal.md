## Why

Fork rejects shared podcast, PDF, and YouTube snapshots when the destination account has the corresponding Lab turned off. An explicit Fork expresses intent to save that content, so a reader should be able to save it without visiting Settings first.

## What Changes

- Treat successful publication of an eligible Fork as consent to enable the matching Lab for the destination account. Commit the Lab change together with the successful bookmark publication.
- Keep the activation rules in the existing Lab registry. The initial rules cover `pdf`, `podcast`, and `youtube`. An ordinary article Fork leaves every Lab setting as it was.
- Apply the same rule to online and synchronous Reader snapshot copies. Source authorization, moderation, and publication checks still govern every copy. Viewing a snapshot, acknowledging a pending copy, and handling an unsuccessful copy have no Labs side effects.
- Keep ordinary external URL capture and explicit uploads governed by their existing acquisition requirements.

## Capabilities

### New Capabilities

### Modified Capabilities

- `bookmark-fork` permits an otherwise eligible copy with the matching Lab off and enables that Lab atomically on successful publication.

## Impact

The change is confined to the existing Fork and Labs domain services and repositories. It uses the current Reader entry points, Workflow, response envelope, and per-account Labs table.
