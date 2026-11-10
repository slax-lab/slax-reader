# Proposal

## Why

The merge-triggered archive workflow and its later trigger revisions cost more operational complexity than they save. The repository will keep the original author-driven archive process and remove the dormant automation rather than retaining another disabled system.

## What Changes

- **BREAKING**: Remove the `openspec-archive` agentic workflow, its compiled lock, and its dedicated workflow contract tests.
- Remove the OpenSpec archiving CI runbook and automatic post-merge evaluation guidance.
- Retire every requirement in the living `openspec-change-archiving` capability; historical archived changes remain unchanged.
- Delete the `OPENSPEC_ARCHIVE_ENABLED` repository variable after the implementation merges and no archive evaluation is running.

## Non-goals

- Do not change the shared DeepSeek engine, ordinary PR Review workflows, readiness gates, or notification contracts.
- Do not close or rewrite existing archive pull requests, merged pull requests, or archived OpenSpec changes.
- Do not introduce a replacement archive reminder or automation mechanism.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `openspec-change-archiving`: Remove all seven requirements and retire the living capability; authors continue to archive through separate human-reviewed documentation pull requests.

## Impact

- Remove `.github/workflows/openspec-archive.md`, `.github/workflows/openspec-archive.lock.yml`, and `tooling/openspec-archive-workflow.test.mjs`.
- Update `package.json`, `docs/CI.md`, and `openspec/config.yaml`.
- Remove `openspec/specs/openspec-change-archiving/spec.md` when this change is archived.
- Verify with `pnpm test:ci`, `pnpm agent:check`, strict OpenSpec validation, and a repository search limited to non-historical files.
