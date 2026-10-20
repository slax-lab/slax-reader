# Design

## Evidence retirement

The former mobile evidence directory is deleted rather than archived in-tree. The coverage ledger and native-evidence verifier are removed because they exist solely to validate that directory. The evidence-only Mobile CI job and its scope output are removed with them. `pnpm mobile -- check` continues to validate the source manifest, copied assets, localization, fixtures, architecture, types, and tests; it no longer claims native render parity.

## References

Every external reference to the former evidence directory is removed. Files that cannot function without the deleted artifacts—capture executors, their runtime plans, archived-snapshot guard tests, and report bindings—are deleted rather than rewritten with a placeholder path. Native control sources, build drivers, and every check that runs without the artifacts are retained. Documentation and fixture guides describe the remaining checks and native acceptance limits without presenting retired artifacts as proof.

## Historical OpenSpec changes

Completed Mobile application changes are archived after their evidence references are cleaned. `expo-mobile-migration` records that the user completed manual acceptance on 2026-10-19 and that the remaining unchecked tasks are agent automation or receipt gaps, not open product acceptance. The evidence retirement is recorded in the archived change note. Applications with incomplete tasks that have not been explicitly accepted remain active.

## Git history

This change removes evidence from the current tree. It does not rewrite Git history. Reclaiming the compressed historical bytes requires a separate, coordinated history-rewrite operation outside this change.

## Verification

- `node apps/mobile/assets/verify-baseline.mjs` validates the remaining source and asset checks.
- `pnpm mobile -- check` and `pnpm mobile -- bundle` remain the Mobile CI contract.
- `pnpm test:ci` covers the updated scope and workflow routing.
- `openspec validate --all --strict` passes after the cleanup and archives.
- A repository audit finds no external path into the deleted evidence directory.
