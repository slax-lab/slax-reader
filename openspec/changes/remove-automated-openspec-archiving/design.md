# Design

## D1. Delete only the dedicated automation

Remove the archive workflow Markdown and its generated lock through the normal gh-aw compilation and orphan-purge path. Delete its dedicated test and remove that test from `test:ci`. Keep `shared/deepseek-engine.md` because the ordinary PR Review workflows still import it.

## D2. Retire the living capability without erasing history

The delta marks all seven `openspec-change-archiving` requirements as REMOVED and declares `retire_capabilities: true`. Archiving the change removes the living capability instead of leaving an empty specification. Files under `openspec/changes/archive/` remain audit history.

## D3. Restore author-driven operational guidance

Remove the automatic archiving section from `docs/CI.md`. Change the OpenSpec operation guidance so completion of a task PR is followed by an author-driven, separate documentation PR. The existing human review and unchecked-task classification rules remain unchanged.

## D4. Remove external configuration after code removal

Keep `OPENSPEC_ARCHIVE_ENABLED=false` until the implementation merges. Confirm no archive workflow run is active, then delete the repository variable. A missing workflow or variable must not affect ordinary CI, PR Review, readiness labels, or notifications; no replacement trigger is added.
