## MODIFIED Requirements

### Requirement: Runtime values have one private configuration source

The release SHALL accept runtime strings, including credentials, from the top-level `[vars]` table of the selected private `api/dev.toml`, `api/beta.toml`, or `api/prod.toml`. Normal Wrangler publication SHALL supply these values to all five API Workers (Edge, Core, AI, Objects and Browser) without a separately maintained runtime Secret upload step. Deployment access credentials SHALL remain environment-scoped Actions Secrets. Real runtime values MUST NOT be committed to the public source repository.

#### Scenario: An operator restores a runtime credential
- **WHEN** the selected private TOML contains a runtime credential in `[vars]`
- **THEN** validation accepts it and every generated Worker configuration carries the exact value

#### Scenario: Configuration attempts to execute private commands
- **WHEN** configuration contains a build hook or other forbidden executable setting outside `[vars]`
- **THEN** the loader rejects it without exposing configuration content
