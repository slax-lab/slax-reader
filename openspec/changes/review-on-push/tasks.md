# Tasks

## 1. Trigger change

- [x] 1.1 In `.github/workflows/pr-review.md`, add `synchronize` to the `pull_request` trigger types (result: `types: [opened, ready_for_review, reopened, synchronize]`) and update the adjacent comment to note that pushes on same-repository heads re-run the review while the compiled fork/draft guards still apply; verify by reading the edited front matter back

## 2. Recompile agentic workflows

- [x] 2.1 Confirm the local gh-aw CLI matches the version pinned in `.github/workflows/agent-config.yml` (`gh aw --version` against the pin; install with `gh extension install github/gh-aw --pin <version>` if not), verified by `bash tooling/check-gh-aw-drift.sh` reaching the compile step rather than failing on the version check
- [x] 2.2 Run `gh aw compile --strict --purge --no-check-update` and stage the regenerated outputs (`pr-review.lock.yml`, and `.github/aw` if touched); verify `git status` shows the lock file regenerated and no other unexpected workflow changes
- [x] 2.3 Inspect the recompiled `pr-review.lock.yml`: its activation condition must still contain `head.repo.id == github.repository_id` and the pre-activation must still carry the `admin,maintainer,write` membership check, and the trigger must now include `synchronize`; verify with `grep` for all three in the lock file
- [x] 2.4 Run `pnpm agent:check` and verify it passes (rulesync check, OpenSpec strict validation, gh-aw drift check)

## 3. Documentation source update

- [x] 3.1 In `.rulesync/rules/overview.md`, update the promotion-notes sentence that says the review triggers "do not include `synchronize`" to reflect that pushes now re-trigger the review (keeping the conflicted-open caveat and the `/review` remedy as fallback); verify by reading the paragraph back
- [x] 3.2 Run `pnpm agent:sync` and stage the regenerated files (`AGENTS.md`, `CLAUDE.md`, `.claude/`, `.codex/`, `.agents/` as touched) in the same commit as the rulesync edit; verify `pnpm agent:check` still passes

## 4. Gate: cancelled-and-superseded runs stay silent

- [x] 4.1 In `.github/workflows/pr-review-gate.yml`, before the status computation, detect `conclusion == "cancelled"` and list newer same-PR runs of `pr-review.lock.yml` (event `pull_request`) and `pr-review-command.lock.yml` (events `issue_comment`/`pull_request_review_comment`); when a successor exists, exit without posting; otherwise fall through to fail closed. Verify the workflow still parses as YAML and the extracted script passes `bash -n`
- [x] 4.2 Verify the successor filter's jq program against a fixture payload: a newer same-PR `pull_request` run counts; `#1470` does not match `#147`; non-`pull_request` events and older runs are excluded
- [x] 4.3 Update the gate's header comment, which previously claimed every cancelled run fails closed, to describe the recognized cancelled-and-superseded shape; verify by reading the comment back

## 5. Review feedback from this change's own PR

- [x] 5.1 Resolve the automated review's Important finding (the spurious failing gate on rapid pushes) via task group 4, and its Nits: scope the delta spec's gate-attribution clause and extend the rapid-push scenario, and sync `openspec/specs/release-branching/spec.md`'s stale "triggers do not include `synchronize`" sentence via a new delta in this change; verify `openspec validate --all --strict` passes

## 6. Pre-push review

- [ ] 6.1 Re-run the local pre-push review defined in `REVIEW.md` over the full branch diff (all passes, including the compliance pass against this change's artifacts) and resolve Important findings; verify no unresolved Important finding remains before pushing
