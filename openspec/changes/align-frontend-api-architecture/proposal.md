# Proposal

Align the Web and Extension development surface with the merged API monorepo architecture. Frontend commands keep their deploy-scoped environment files, project API bindings from a small public projection, and share compatible contracts without importing API implementation details.

## Scope

- Generate a minimal Web Cloudflare configuration from public API deployment metadata.
- Keep frontend profile selection separate from API native environment selection.
- Make local state paths explicit for Wrangler and Nuxt.
- Preserve deploy/local for the backend.
- Clarify frontend setup, preflight, CI and contract boundaries.

## Non-goals

- Renaming backend deploy/local.
- Changing API schema, migrations, secrets, or remote deployment.
- Running a real backend integration during this phase.
