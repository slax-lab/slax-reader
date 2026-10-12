## ADDED Requirements

### Requirement: Runtime values have one private configuration source

The release SHALL accept runtime strings, including credentials, from the top-level `[vars]` table of the selected private `api/dev.toml`, `api/beta.toml`, or `api/prod.toml`. Normal Wrangler publication SHALL supply these values to all four Workers without a separately maintained runtime Secret upload step. Deployment access credentials SHALL remain environment-scoped Actions Secrets. Real runtime values MUST NOT be committed to the public source repository.

#### Scenario: An operator restores a runtime credential
- **WHEN** the selected private TOML contains a runtime credential in `[vars]`
- **THEN** validation accepts it and every generated Worker configuration carries the exact value

#### Scenario: Configuration attempts to execute private commands
- **WHEN** configuration contains a build hook or other forbidden executable setting outside `[vars]`
- **THEN** the loader rejects it without exposing configuration content

### Requirement: Recovery preserves unavailable remote values

Remote deployment SHALL retain existing remote variables and Secrets omitted from the TOML during recovery. Explicitly configured TOML values SHALL replace same-name remote bindings. Unrecoverable values MUST remain absent or commented rather than being published as empty values, invented credentials or placeholders. Local deployment MUST NOT inherit remote preservation behavior.

#### Scenario: A provider key has not been recovered
- **WHEN** an existing remote key is absent from the private TOML
- **THEN** deployment preserves it and the operator can subsequently supply its original value in that TOML

#### Scenario: A shared credential is explicitly restored
- **WHEN** a runtime credential already exists as a remote Secret and its real value is added to the TOML
- **THEN** normal deployment replaces that binding with the configured variable for each Worker

### Requirement: Private runtime values remain withheld during release

Generated runtime configuration MUST have owner-only file permissions. Private configuration and tool output MUST remain in restricted temporary storage during public releases and MUST NOT appear in public logs, generated Env literal types, caches or artifacts. Existing cleanup, merged-PR gating, environment selection and deployment sequencing SHALL remain intact.

#### Scenario: A runtime private key spans multiple lines
- **WHEN** the private TOML contains a multiline runtime string
- **THEN** generation preserves the string exactly in an owner-only file without publishing it to public output

#### Scenario: Release fails while processing private configuration
- **WHEN** parsing or validation raises an exception
- **THEN** the public log reports only the existing safe stage result and cleanup removes private release files
