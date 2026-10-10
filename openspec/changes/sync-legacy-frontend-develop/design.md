# Design

## Context

See `proposal.md` for motivation and `audit.md` for all comparison points. The legacy application paths differ from v2, and shared frontend types, utilities, and API contracts have been split since import. All 18 existing files in the source delta still match the old runtime behavior; v2 differences in those files are import migrations. Five source additions are missing. Existing v2 outline highlighting and theme rules must remain intact.

## Goals / Non-Goals

**Goals:** Reproduce the final source behavior with v2-compatible imports, preserve existing application improvements, and keep source attribution and validation evidence explicit.

**Non-goals:** Redesign the source feature, change API contracts or package versions, import the legacy CI/deployment architecture, or operate on the old working directory.

## Decisions

### Apply the final bounded delta against the recorded import base

Map `apps/slax-reader-dweb` to `apps/web` and `apps/slax-reader-extensions` to `apps/extension`. Reconcile each of the 23 files against the old base and target base. Existing target imports win; new `BookmarkTag` imports use `@commons/frontend-types/models`. Preserve unrelated target files and formatting where practical.

A whole-tree copy would revert monorepo API and theme work. Replaying every old commit would introduce transient tag implementations and temporary reports. A final-delta port retains the intended final behavior with a smaller review surface.

### Keep the source's renderer and component boundaries

Register the table layout processor in the existing article processing pipeline. Preserve DOM structure, schedule resize measurements, observe table content growth, and disconnect observers/cancel pending frames on cleanup. Keep CSS scrolling as the fallback before measurement. The existing outline anchor processor remains unchanged and is covered by regression checks.

Use the source's separate detail tag component, shared interaction helper, and explicit topic/list variants. Keep v2 theme tokens and existing tag data flows. Do not move tag code to a shared package because the Extension does not consume it. New comments are written in English; imported Chinese comments in changed blocks can be translated without changing behavior.

Port the two Extension changes independently of Web styling: native Shift+Enter handling, and popup-host stacking. Preserve the fixed-dark Extension profile.

### Preserve v2 setup and CI

Legacy `ddcf9bc6` and `50de9f64` target an obsolete workflow and deployment documentation. V2's `.github/workflows/frontend-ci.yml` already provides non-secret configuration at job scope before dependency installation and runs monorepo checks. Keep it unchanged. Temporary source agent reports are also excluded.

## Risks / Trade-offs

- Cross-repository imports can silently restore removed package names → audit all changed import paths and run Web/Extension type checks.
- Happy DOM cannot prove CSS geometry or native editing → supplement source unit tests with browser smoke checks for narrow/desktop tables, tag layouts and keyboard actions, and Extension caret behavior.
- Table measurements can oscillate or leak after unmount → test resize transitions and cleanup; preserve existing annotation DOM selectors.
- Hover-only tag actions can fail keyboard use or compact measurement → verify focus-within, read-only controls, long localized names, and overflow controls in both list variants.
- Local refs may lag remote → record exact SHAs; recheck remote state when connectivity permits before publication.
- Worktree setup can be blocked by local filesystem restrictions → use an independently installed, secret-free validation copy, verify source fidelity, and keep package versions and the lockfile unchanged.

## Migration Plan

1. Obtain human review of these planning artifacts under the repository OpenSpec rule.
2. Port the audited application delta on `feat/sync-legacy-frontend-develop`.
3. Run focused tests, Web typecheck/tests/build, Extension compile/tests/build, design checks, and strict OpenSpec validation with public placeholder configuration; record any environmental limitation precisely.
4. Complete the Bugs, Security, and Compliance pre-push review from `REVIEW.md`, resolving Important findings.
5. Publish one PR to `dev` with `OpenSpec: sync-legacy-frontend-develop` and the audit summary when GitHub is reachable. Do not merge or deploy.
6. If rollback is required, revert the synchronization commit; no database or API migration is involved. Archive the OpenSpec change through the normal separate post-merge process.
