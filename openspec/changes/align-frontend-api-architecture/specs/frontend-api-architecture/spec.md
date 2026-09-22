# Frontend/API architecture

## ADDED Requirements

### Requirement: public API metadata projection

The repository MUST derive Web's ContentEntry service and OSS binding from a minimal projection of non-secret API deployment metadata, honoring explicit frontend overrides and never copying API vars or secrets.

#### Scenario: custom edge and preview bucket

- **WHEN** API metadata selects a custom Edge service and an OSS preview bucket
- **THEN** generated Web config uses that service and preview bucket while preserving the formal bucket name.

#### Scenario: missing API metadata

- **WHEN** offline frontend prepare, typecheck, or build runs without API metadata
- **THEN** a safe public default is used; local dev and SSR display initialization guidance.

### Requirement: independent environment selection

Frontend profile selection MUST remain independent from native API environment selection and MUST support process values, deploy profile files, and deploy base files with deterministic precedence.

#### Scenario: local API environment

- **WHEN** API metadata has env.dev but frontend SLAX_ENV is development
- **THEN** Web uses the frontend development files and the API projection selects env.dev only according to API native rules.

### Requirement: stable local bindings

The Web toolchain MUST retain both ContentEntry and OSS bindings, use deploy/local_web generated config, and use state/v3 for Nuxt persistence while Wrangler CLI persistence points at state.

#### Scenario: tracked config

- **WHEN** a frontend build or type generation runs
- **THEN** tracked operator configuration is not modified.

### Requirement: contract boundaries

Shared contracts MUST expose wire compatible API types while frontend-only models remain in frontend-types and no frontend bundle imports API deployment or implementation modules.

#### Scenario: frontend model import

- **WHEN** Web or Extension needs a UI-only model whose fields differ from API JSON
- **THEN** it imports the model from frontend-types and keeps the API contract import for wire payloads.
