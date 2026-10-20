# Design

## Context

The repository already specifies what to build (OpenSpec) and how pull requests are reviewed (`REVIEW.md`, applied by the gh-aw review agent from the PR's head branch, with `pr-review-gate` converting Important findings into a required failing status). What is missing is the middle: no agent-readable document defines how a change is proven to work. Supporting facts that shape the approach:

- Root agent rules are generated from `.rulesync/rules/*.md` by `pnpm agent:sync`; hand edits to `AGENTS.md` and its siblings are blocked by hook and CI.
- `.github/PULL_REQUEST_TEMPLATE.md` asks for a Test plan but no agent rule references it, and agents creating PRs with `gh pr create --body` bypass the template entirely.
- A folk convention already exists: 19 change directories carry `validation.md`/`verification.md` records, but `REVIEW.md` does not read them and OpenSpec does not require them.
- `openspec/config.yaml` already injects one advisory line into the apply loop (`operations.apply.guidance`).
- `agent-config.yml` already guards two generated-file classes with a regenerate-and-diff pattern (`rulesync generate --check`; `gh aw compile --strict --purge` + `git status --porcelain`); OpenSpec skill files have no such guard, so a globally installed `openspec` CLI of a different version can silently rewrite them.
- `apps/mobile/AGENTS.md` (source `.rulesync/rules/mobile-architecture.md`) already demands native acceptance on real devices, without binding it to any evidence record.
- The repository is public, so `github.com/user-attachments` URLs are fetchable without authentication (verified against merged PRs in other public repositories).
- gh v2.99.0 (2026-09-01) added `--attach` to `gh pr/issue create/edit/comment`, giving agents a native upload path; it is now a machine prerequisite via `docs/LOCAL-SETUP.md`.

## Goals / Non-Goals

**Goals:**

- Make the definition of done agent-consumable at the point of work (session-start rules and the OpenSpec apply loop), not in documents agents never open.
- Enforce it at review time with no new human steps, reusing the existing review agent and merge gate.
- Preserve pre-PMF velocity: a declared verification gap is compliant; only silence blocks.
- Keep one source of truth per concern (policy in `REVIEW.md`, rules in `.rulesync/`, workflow guidance in `openspec/config.yaml`).

**Non-Goals:**

- The review agent viewing attached screenshots. Feasibility was investigated separately: it works only via gh-aw plumbing (an unsandboxed setup job that downloads PR attachments to fixed paths, plus `engine.args` `--attachment`), with one unverified hop (whether the AWF api-proxy forwards multimodal message parts) and a known silent-confabulation failure mode (Copilot CLI drops tool-result images under BYOK; upstream bugs #4536/#4600; gh-aw feature request #21242 open). Designed as its own follow-up change starting with a drill PR.
- Per-app acceptance runbooks (which scenarios to exercise per app) — a follow-up change.
- A deterministic PR-body lint — the review check already judges evidence semantically; add only if leakage is observed.
- Teaching non-engineer contributors software engineering — the design puts guardrails in the workflow, not training on people.

## Decisions

### D1: The Definition of Done lives in `.rulesync/rules/overview.md`

`AGENTS.md` (generated from that source) is the only file every agent is guaranteed to read at session start; discoverability is the root failure this change fixes. A standalone doc under `docs/` was rejected: it would join the per-app verification docs that agents already never open. The section stays terse and links the per-app development docs for commands — OpenAI's harness experience ("one big AGENTS.md" fails because too much guidance becomes non-guidance) argues against moving detail into it.

### D2: Evidence is a file in the change directory, summarized in the pull request

`openspec/changes/<change-id>/validation.md` is durable, reviewable in the diff, and archives with the change; the PR Test plan summarizes and links it. This formalizes the 19-file folk convention instead of inventing a new one. PR-body-only evidence was rejected: it is not archived and not diff-reviewable.

### D3: Enforcement is a new Compliance-pass step in `REVIEW.md`, severity Important

`REVIEW.md` is the review agent's single source of policy, read from the head branch, so one edit propagates to both the local pre-push review and CI review with zero workflow changes. Important severity routes through the existing `pr-review-gate`, turning "missing evidence" into a blocked merge. A declared gap ("X not verified, because Y") is explicitly compliant — the gate blocks silence, not honesty. Alternatives rejected: Nit severity (a Nit does not block, and `REVIEW.md` itself notes prompt-level duties get skipped); a deterministic body lint (only checks section presence, which empty evidence satisfies — deferred).

### D4: Media uploads via `gh --attach`; the text record stands alone

Media never enters git (history is permanent; recordings would add gigabytes per year). `gh --attach` gives agents a native, authenticated upload path with permanent links and repo-scoped visibility, at zero new infrastructure. The text record must stand alone because today's review pipeline cannot deliver images to the model (the sandbox network allowlist has no route to GitHub; the gh-aw copilot engine drops tool-result image blocks under BYOK). Alternatives rejected: committing media (history bloat), Git LFS (quota and tooling cost for short-lived evidence), Actions artifacts (90-day expiry and CI-only upload), self-hosted R2 storage (new infrastructure disproportionate to the stage).

### D5: The review-feedback loop is an agent rule, not new automation

The author agent polls its PR (`gh pr view --comments`, review-comments API), resolves or answers every Important finding, and pushes; the existing `synchronize` trigger re-runs the review, with `/review` as the fallback. A notification bot was rejected: polling by the author agent covers the need, and human IM reminders degrade to a fallback.

### D6: The OpenSpec skill drift check mirrors the gh-aw drift check

In `agent-config.yml`: regenerate skill files with the pinned `@fission-ai/openspec` (via `pnpm exec openspec update`, non-interactive) and fail on `git status --porcelain` over the generated paths — the same regenerate-and-diff pattern already proven for gh-aw. `openspec doctor` was rejected: it reports spec/store health, not skill freshness, and the CLI has no `--check` mode. This converts the existing "skills refresh only in tool-upgrade PRs" convention from prompt-level to enforced.

### D7: No delta to the `agentic-pr-review` capability

Its spec deliberately defers policy content to `REVIEW.md` ("This specification does not restate the policy's contents"). The evidence check is policy content, so the delta lives in the new `change-verification` capability; duplicating it into `agentic-pr-review` would create a second source of truth.

### D8: Mobile aligns through its rulesync source

`.rulesync/rules/mobile-architecture.md` gains the evidence binding (native acceptance results are recorded in `validation.md` like any other verification); the generated `apps/mobile/AGENTS.md` keeps a single clause rather than a parallel process.

### D9: Verification scenarios derive from the change's own spec, then the app's smoke flows

The DoD names where "what to exercise" comes from: the change's delta-spec WHEN/THEN scenarios and proposal intent are the acceptance criteria — their quality is set at proposal review, when a human is already looking — and the affected app's development doc provides the standard smoke surface for regression. A change without an OpenSpec proposal derives smoke-level verification from its diff's touched surface; documentation- and typo-scale changes are exempt outright. This makes the OpenSpec artifacts load-bearing at verification time, not only at implementation time. A fixed global acceptance checklist was rejected: it cannot name change-specific behavior and would rot; curated per-app acceptance runbooks remain a follow-up (Non-Goals).

## Risks / Trade-offs

- The review agent may misjudge evidence adequacy (false Important or false pass) → the declared-gap path is trivial to comply with; `/review` re-runs after fixes; recurring misjudgments are tracked in `REVIEW.md`'s Recurring findings table and promoted into rules by humans.
- Evidence theater (plausible but fabricated evidence) → the contradictory-evidence clause checks claims against CI facts; attaching real screenshots via `gh --attach` is cheap; full mitigation is the image-viewing follow-up (Non-Goals).
- Added `AGENTS.md` length spends agent context budget → the DoD section is deliberately terse and delegates commands to linked per-app docs (D1).
- `openspec update` may prompt interactively or write unexpected paths in CI → implementation includes a drill: run the exact CI commands locally first, pin non-interactive flags, and enumerate the generated paths the diff covers.
- Existing machines have older `gh` → one-time upgrade announced at merge; the runbook row for new machines already landed (PR #287).

## Migration Plan

1. Land the change in one PR: rulesync sources + regenerated files, `REVIEW.md`, PR template, `openspec/config.yaml`, `agent-config.yml`.
2. At merge, announce to the team: new Definition of Done, one-time `gh` upgrade, and where `validation.md` lives. Agents pick the rules up automatically on their next session.
3. Rollback: revert the PR; the gate and policy return to their previous state. No data or runtime migration involved.

## Open Questions

None that change the specs or task breakdown. (Deferred by choice, tracked in Non-Goals: deterministic body lint; image-viewing review.)
