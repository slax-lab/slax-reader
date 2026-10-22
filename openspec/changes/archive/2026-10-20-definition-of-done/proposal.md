# Proposal

## Why

Non-engineer teammates now ship pull requests with coding agents, but the team's definition of done — a behavior change must be exercised in a running environment and shown to work, not merely pass automated checks — exists only as unwritten engineer knowledge. Agents cannot inherit unwritten norms: OpenSpec specifies what to build and `REVIEW.md` gates how a pull request is reviewed, but nothing an agent reads defines how a change is proven to work. The predictable result: pull requests arrive with code written and unit-level checks green, and the missing functional verification surfaces only when a human notices during review.

## What Changes

- Add a **Definition of Done** section to the root agent rules (source `.rulesync/rules/overview.md`, regenerated with `pnpm agent:sync`): before a behavior-changing pull request is opened, the changed behavior must be exercised in a running environment (agent-driven where possible). What to exercise derives from the change's own delta-spec WHEN/THEN scenarios and proposal intent — they are the acceptance criteria — plus the affected app's documented smoke flows; a change without an OpenSpec proposal derives smoke-level verification from its diff's touched surface. For UI-visible changes, the evidence also satisfies `DESIGN.md`'s verification requirements (themes, responsive widths, recorded states): the agent produces the visual evidence pack, and the human judges design intent through hands-on acceptance in the agent-prepared running environment before the pull request opens — adjustments requested during acceptance are implemented and re-verified first, and the acceptance is recorded in `validation.md`; unlike agent-executable verification, this acceptance step has no declared-gap path. Verification is recorded in `openspec/changes/<change-id>/validation.md` and summarized in the pull request's Test plan; a declared "not verified, because …" entry is acceptable evidence while silence is not; pull request bodies follow the repository template rather than free text.
- Add a **media evidence rule**: screenshots and recordings are uploaded with `gh --attach` (requires gh v2.99.0+, now a machine prerequisite) and never committed to the git repository; `validation.md` and the Test plan must read completely without the media, because the automated review evaluates text only.
- Add a **review-feedback loop rule** for author agents: poll and address pull request review comments (automated or human) without waiting for a human IM reminder; pushing re-triggers the automated review, with `/review` as fallback.
- Extend the `REVIEW.md` Compliance pass with a **verification-evidence check**: a behavior-changing pull request whose body lacks a credible evidence trail (missing Test plan section, empty evidence, or evidence contradicting observable facts) earns an Important Compliance finding — which makes the existing merge gate block it.
- Upgrade `.github/PULL_REQUEST_TEMPLATE.md`: the Test plan section becomes an explicit evidence requirement (commands run, scenarios exercised, what was not verified and why, link to `validation.md`).
- Point `openspec/config.yaml` `operations.apply.guidance` at the Definition of Done so the requirement surfaces inside the OpenSpec implement loop.
- Add an **OpenSpec skill drift check** to the agent-config CI guard: regenerate the skill files with the pinned `@fission-ai/openspec` and fail on any diff, mirroring the existing gh-aw drift check, so generated agent skills change only in deliberate tool-upgrade PRs.
- Align `apps/mobile` native-acceptance rules (source `.rulesync/rules/mobile-architecture.md`) with the evidence requirement: native acceptance results are recorded the same way.

Non-goals: the automated review agent itself viewing attached images (feasibility investigated separately; it needs gh-aw plumbing plus an unverified proxy hop and is designed as its own follow-up change); per-app acceptance runbooks; a deterministic PR-body lint (the review check already covers evidence semantics).

## Capabilities

### New Capabilities

- `change-verification`: the verification-evidence contract for changes — what "done" means for a behavior change, how verification evidence is recorded and presented in the pull request, how the media rule keeps evidence out of git history, how review policy enforces the contract, how author agents close the review-feedback loop, and how the generated agent instruction files carrying these rules stay in sync with their pinned generators.

### Modified Capabilities

None. `agentic-pr-review` deliberately defers review policy content to `REVIEW.md` as its single source of truth, so the review-side evidence check (a `REVIEW.md` content change) requires no requirement delta.

## Impact

- `.rulesync/rules/overview.md` and `.rulesync/rules/mobile-architecture.md`, plus the files regenerated from them by `pnpm agent:sync` (`AGENTS.md`, `CLAUDE.md`, `.claude/`, `.codex/`, `.agents/`, `apps/mobile/AGENTS.md`).
- `REVIEW.md` (Compliance pass gains a verification-evidence step).
- `.github/PULL_REQUEST_TEMPLATE.md` (Test plan becomes an evidence requirement).
- `openspec/config.yaml` (`operations.apply.guidance`).
- `.github/workflows/agent-config.yml` (new OpenSpec skill drift check).
- `tooling/ci-scope.mjs` and its test (the `openspec` scope now also triggers on the generated skill paths, so skill-only pull requests run the new check).
- No application code, no APIs, no runtime dependencies.
- Machine prerequisite: GitHub CLI v2.99.0+ (landed separately in `docs/LOCAL-SETUP.md`, PR #287); existing machines need a one-time `gh` upgrade, announced when this change merges.
