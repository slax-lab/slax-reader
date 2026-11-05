# Validation

## Exercised checks

- `pnpm test:ci`: 81 tests passed without the deleted archive workflow contract test. The ordinary PR Review ready-transition and no-bot-allowlist assertions were relocated into `tooling/ci-workflow.test.mjs`.
- `pnpm agent:check`: rulesync doctor and generation check passed; 105 OpenSpec items passed strict validation; gh-aw compiled two remaining workflows and reported that compiled workflows match their sources.
- `pnpm exec openspec validate remove-automated-openspec-archiving --strict`: passed.
- `git diff --cached --check`: passed.
- Repository search for `OPENSPEC_ARCHIVE_ENABLED` and `openspec-archive`: only this change, generated archive-skill documentation, and historical archived changes remain. No live workflow, tooling test, CI runbook, or living-spec reference remains.

## Running-environment evidence and declared gap

This change removes repository automation only; it changes no application runtime, UI, API, or shipped package. The workflow was exercised through gh-aw compilation, orphan purging, drift verification, and the remaining CI contract tests.

I did not trigger an archive evaluation or create another archive PR because the capability is intentionally disabled and being removed. After the implementation PR merges, confirm the archive workflow is absent and no evaluation is running, then delete `OPENSPEC_ARCHIVE_ENABLED`. No replacement automation will be introduced.

## Local pre-push review

- Bugs: No Important findings. The shared DeepSeek engine and ordinary PR Review/readiness workflows are unchanged; only dedicated archive files and guidance are removed.
- Security: No Important findings. The diff removes an automation identity and network-capable workflow without adding permissions, dependencies, secrets, or outbound calls.
- Compliance: No Important findings. The implementation matches the seven removed requirements and preserves historical archives and human-reviewed archive delivery.
