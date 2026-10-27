# Design

## Context

This design replaces the first R08 attempt (`828cc730`, `e8d7c422`) with a target structure written against the actual delivery base. See `proposal.md` § "Status" for why the old plan cannot be re-applied.

Facts at the revision base (`recovery/base` at `773d6093`, ten commits ahead of then-`origin/dev` at `9188be24`). The H3 prerequisites have since advanced the base to `dev` at `751e337b`; implementation now targets that tree, where `README.md` carries F05's map, `DESIGN.md` has §10.1/§10.2 in their final optional form, `REVIEW.md` has the material-UX no-finding clause, and D06's `change-verification` delta is archived into the living spec. The list below records the revision-time state:

- `docs/BRANCHING.md`, `docs/README.md`, `docs/DEFINITION-OF-DONE.md`, and `docs/release/VERSIONING.md` do not exist.
- `DESIGN.md` has `## 10. Change workflow` but no §10.1 or §10.2. The material-UX demo checkpoint and the hands-on acceptance procedure exist only on the D06 branch.
- `REVIEW.md`'s compliance pass points at `"Definition of Done" in AGENTS.md` and has no material-UX step. Step 6 exists only on the pre-approval D06 branch; the final approved D06 form adds the no-finding clause, not a review step.
- `README.md` line 25 says the monorepo hosts "all non-mobile Slax Reader code" and the repository table has no `apps/mobile` row. F05 corrects both.
- `docs/CI.md` is 134 lines, titled `# CI scope selection`, and owns the branch-protection section (`docs/CI.md:7-21`) plus the CI mechanics.
- `docs/web/deployment.md:5-13` states the merged-target-branch release destinations. `docs/api/DEV-AND-CI-EN.md:52-54` states that only a merged PR into `dev`, `beta`, or `main` with API-related changes deploys the API.
- The root rules source `.rulesync/rules/overview.md` is 143 lines and still contains the repository map, local setup commands, the version manifest table, the full Definition of Done, the per-branch contracts, the hotfix and promotion mechanics, and the generated-output table.

The information-architecture review supplied the defects this design resolves:

| Review finding | Resolution in this design |
| --- | --- |
| P0-1: "one owner per topic" flattened five layers | D1: five layers, one owner per topic per layer; a topic legitimately appears in several layers with different jobs |
| P0-2: root still copied procedures | D4 and the duplication audit: the root target has no procedure sections |
| P0-3: four verification-exemption texts, only three compared | D6 and H1: all policy texts and the PR template are named; the direction is an explicit adjudication |
| P0-4: the new DoD absorbed UI, review, and Mobile ownership | D3: the DoD is evidence-only; `DESIGN.md` owns the UI workflow; Mobile stays scoped |
| P0-5: scoped design rules were weakened to pointers | D5: the imperatives are restored alongside the section references; a bare pointer is a compliance defect |
| P0-6: VERSIONING pointed Web/API at `docs/CI.md` | D7: point at `docs/web/deployment.md` and `docs/api/DEV-AND-CI-EN.md` |
| P0-7: the same-capability rule appeared twice in root | D4: stated once in the OpenSpec/archiving obligation; the branch section links to it |
| P0-8: the version indirect-effects list was narrowed | D7 and W1: restore the full list in root |
| P1: root ownership list, README map, and branch document | D2 and D10: `docs/BRANCHING.md`; F05 is a prerequisite |
| P1: the generated-output table had three copies and no drift check | D8: machine configuration is authoritative; root carries a short summary; the existing drift checks verify the generators |
| P1: `Per-application smoke flows` did not match the Mobile entry | D3: rename to `Per-application verification guides` |
| P1: the DoD ownership statement was contradictory | D3 and the H4 scope block: the DoD owns the operational evidence procedure; the spec is normative |
| P1: the meta-spec hardcoded document paths | D11: the spec states layers and obligations; the index owns concrete routing where possible |
| Open questions | Reduced to H1–H4 in `proposal.md`; no other decision is deferred |

## Goals / Non-Goals

**Goals**

- One owner per topic per layer, so a rule cannot drift between parallel copies and an edit cannot silently redefine another layer's contract.
- A root file an agent can read in under a minute: non-delegable obligations and pointers only.
- A branch runbook that is separate from CI mechanics and points at the normative and machine owners.
- A verification document that owns evidence only; the UI demo, hands-on acceptance, matrix, and Mobile details stay with their owners.
- Scoped application rules that state the imperative an app agent needs, with the normative section reference.
- A verification policy whose texts agree, with the two semantic choices recorded as explicit adjudication items.
- A delivery plan that names its prerequisites and downstream changes instead of assuming an old history.

**Non-Goals**

- Re-deciding the adopted structural direction.
- Approving or re-applying the first implementation.
- Creating the I09 index or the F05/D06 content inside R08. I09 is an independent follow-up; R08 does not absorb it.
- Changing runtime behavior, CI workflows, rulesets, application code, dependencies, deployment, or package versions.
- Changing the normative requirements of `release-branching`, `agentic-pr-review`, or `ci-scope-selection`.
- Designing a general documentation linter; this plan uses human review and the existing drift checks.

## Decisions

### D1 — Five-layer authority, one owner per layer

The repository has five distinguishable layers, and each answers a different question:

| Layer | Representative artifacts | Question it answers | Forbidden content |
| --- | --- | --- | --- |
| Normative | `openspec/specs/*/spec.md`, `DESIGN.md` | What must be true? | Commands, troubleshooting, step-by-step operations |
| Operational | `docs/BRANCHING.md`, `docs/CI.md`, `docs/DEFINITION-OF-DONE.md`, `docs/release/VERSIONING.md`, `REVIEW.md` | How do we satisfy it? | A new or changed normative threshold |
| Machine contract | `.github/rulesets.expected.json`, `rulesync.jsonc`, pinned tool versions, drift tooling | What is enforced, and how is drift detected? | Prose policy |
| Agent entry | Root `AGENTS.md`, `apps/*/AGENTS.md` | What must an agent not miss, and where does it go? | Detailed procedures, per-branch contracts, copied owner rules |
| Index | `docs/README.md` (I09) | Which document owns this topic? | Rule restatement |

The branch topic shows why the old "one document per topic" rule was wrong. The contract is in `openspec/specs/release-branching/spec.md`; the steps are in `docs/BRANCHING.md`; the enforced values are in `.github/rulesets.expected.json`; the non-delegable obligations are in root `AGENTS.md`; the route is in `docs/README.md`. A second document in the same layer is the defect; a document in another layer with a different job is not.

**Alternative considered:** keep one document per topic and let it carry every layer's content. Rejected because it is the model that produced the duplication: a spec then contains troubleshooting, or a runbook then contains thresholds.

### D2 — Split `docs/BRANCHING.md` from `docs/CI.md`

`docs/BRANCHING.md` is the operational owner of branch responsibilities, the protection table, approvals and merge methods, task branches, promotion, sync-back, hotfix, and promotion-gate troubleshooting. `docs/CI.md` keeps CI scope selection, workflow and gate mechanics, the promotion-integrity check, ruleset drift detection, the required configuration check, review readiness, daily full validation, Mobile EAS, release verification, and local verification. The filename stays `CI.md`; the H1 expands the abbreviation to `# Continuous Integration (CI)`. No all-caps long filename is introduced.

The branch-policy heading, intro, protection table, and the approval-policy sentences in the approval paragraph move from `docs/CI.md:7-21`; the heading stays unchanged, so the table stays a single table. The approval paragraph's `main` six-suite-gate sentence stays in `docs/CI.md` under the promotion-integrity section, because it is gate mechanics. The terminal gate-job and Node.js coverage paragraphs at `docs/CI.md:17-19` likewise stay in `docs/CI.md`. Human review verifies the table against `.github/rulesets.expected.json`; no automated checker is part of this plan. `docs/BRANCHING.md` gives each branch a one-line operational responsibility and the steps that satisfy the contract; the normative per-branch rationale and thresholds stay in the `release-branching` spec, and the enforced values stay in the ruleset JSON.

**Alternative considered:** keep everything in `docs/CI.md` and let it own branch policy too. Rejected by the adopted direction: CI mechanics and branch governance are different operational responsibilities, and the file already mixed them.

### D3 — The DoD owns evidence; `DESIGN.md` owns the UI workflow; Mobile stays scoped

`docs/DEFINITION-OF-DONE.md` owns when verification applies, how to derive it, how to record it, the per-application verification guide links, and one review pointer. It does not own:

- the material-UX demo trigger, demo coverage, or approval-record fields — `DESIGN.md` §10.1 (D06);
- the hands-on acceptance procedure or its no-declared-gap rule — `DESIGN.md` §10.2 (D06, plus this change's sentence);
- the design verification matrix — `DESIGN.md` §6;
- review enforcement — `REVIEW.md`;
- Mobile acceptance details — `apps/mobile/AGENTS.md` and the `change-verification` scenario.

The DoD's UI section records the evidence: who accepted, the date, and what was adjusted. That is an evidence requirement, not a procedure. The section is named `Per-application verification guides`, not `smoke flows`, because the Mobile entry links a development guide that does not describe a smoke-flow set.

**Alternative considered:** keep the DoD as the single verification owner including UI procedure, review enforcement, and Mobile. Rejected: it created three-way duplication with `DESIGN.md`, `REVIEW.md`, and `apps/mobile/AGENTS.md`, and the first R08 attempt could not keep the copies aligned.

### D4 — Root rules carry non-delegable obligations and pointers only

The target root outline is:

| Section | Root keeps | Owner of the detail |
| --- | --- | --- |
| Intro | Product one-liner; "this file carries non-delegable obligations and pointers only" | `README.md` for the repository map |
| OpenSpec workflow | Proposal before observable behavior; human review outside pull requests; strict validation; implementation-only exemption; archive obligation and same-capability sequencing | `openspec/config.yaml`, `openspec/specs/` |
| Design checkpoints | Optional material-UX requirements-discovery demo before dependent implementation; UI hands-on acceptance before the pull request; demo approval authorizes implementation only; an absent demo or record is not a finding | `DESIGN.md` §10.1/§10.2, `REVIEW.md` |
| Branches and pull requests | One task/branch/PR from `origin/dev`; no commits on long-lived branches; agents never merge promotion/sync-back/hotfix; same-capability link | `docs/BRANCHING.md` |
| Verification evidence | Behavior change done only when exercised and recorded; automated checks do not substitute; declared-gap rule; exemption sentence | `docs/DEFINITION-OF-DONE.md`, `openspec/specs/change-verification/spec.md` |
| Review | Read `REVIEW.md`; local pre-push review; `OpenSpec:` line; close the loop | `REVIEW.md` |
| Package versions | Full indirect-effects trigger; ask once; no assumption while pending | `docs/release/VERSIONING.md` |
| Generated artifacts | Three generator classes with outputs and checks; machine configuration authoritative | `rulesync.jsonc`, pinned tools, drift tooling |
| Secrets | Prohibition and "ask the human" | Root (no other owner) |
| Documentation language | English-authoring rule and existing-document exemption | Root (no other owner) |
| Personal local instructions | `AGENTS.local.md` precedence | Root (no other owner) |

The root removes the repository map, the local setup commands, the version manifest table, the full verification procedure, the per-application smoke list, the per-branch contracts, the promotion and hotfix mechanics, and the material-UX record fields. The archive lifecycle stays as two obligations because no other document owns it; it is not a step-by-step procedure.

The root deliberately keeps two full decision rules that also appear in an owner:

- the version trigger including "shared packages, API contracts, tooling, and configuration outside the application directory", because a narrower summary changes an agent's behavior;
- the verification exemption sentence, because it is a one-line decision rule and the user asked for the four texts to agree.

Both are summaries of a decision, not a procedure. The duplication audit below records the boundary.

**Alternative considered:** make the root a pure link list with no decision rules. Rejected: an agent reading only the root would miss the indirect-effects scope and the exemption, which is exactly the failure the old attempt produced.

### D5 — Scoped application rules keep the imperative and cite the section

`DESIGN.md` remains the normative owner. Scoped files exist so an app agent sees the application-specific consequence without reading the whole contract. The target keeps the imperative and adds the section reference; a bare pointer is not sufficient because the agent may not read the cited section before acting.

Exact target wording is in § "Scoped rules".

**Alternative considered:** keep pointer-only scoped files. Rejected: the risk is asymmetric. A pointer that is not followed loses the rule entirely; an imperative plus a pointer loses nothing and adds a verification target.

### D6 — Verification policy texts agree; H1 and H2 are decided

The four policy texts are the root rules, the DoD, the `change-verification` requirement paragraph, and the `change-verification` scenarios. The PR template mirrors them. Today they disagree in two ways:

- the requirement paragraph omits `comment`, while the "Documentation-only change is exempt" scenario includes it;
- the DoD adds "any related living specs" as a no-proposal input, while the "Non-behavioral code change is smoke-tested from its diff" scenario lists only the diff's touched surface and the app's smoke flows.

R08 recorded both choices in `proposal.md` H1/H2, and the human approved the recommended option A for both on 2026-10-26. The exact sentences are in § "Verification policy decisions". The delta to `change-verification` carries the approved wording; no alternative edit is needed. The change must not leave one text saying something the others deny.

**Alternative considered:** leave the spec untouched and only align the DoD to it. Rejected because the spec already disagrees with itself; "match the spec" is ambiguous, and a silent choice is the defect the review found.

### D7 — Version decisions move to an owner; Web/API point at deployment docs

`docs/release/VERSIONING.md` owns when to ask, how to ask, and what follows. It keeps the manifest table and the explicit Web/API exemption. It does not own per-application channel mechanics; those stay in `docs/cli/RELEASE.md`, `docs/extension/RELEASE.md`, and `docs/mobile/release.md`.

The Web/API sentence is corrected to:

> Web and API deployments do not use package-version increments. Their release conditions are owned by `docs/web/deployment.md` (which maps a merged target branch to an environment and destination) and `docs/api/DEV-AND-CI-EN.md` (only a merged PR into `dev`, `beta`, or `main` with API-related changes deploys the API). `docs/CI.md` owns the CI gate mechanics, not those release conditions.

The root restores the full indirect-effects list: "shared packages, API contracts, tooling, and configuration outside the application directory". The file stays at `docs/release/VERSIONING.md` because I09's index already maps that path; a rename to `docs/PACKAGE-VERSIONS.md` would add churn without changing ownership.

**Alternative considered:** keep version decisions in root and per-app release docs. Rejected: no document owned "when must an agent ask"; the root was the only place that said it.

### D8 — Generated artifacts: machine configuration is authoritative

The root carries a three-line summary:

| Generator | Outputs | Source and check |
| --- | --- | --- |
| rulesync | `AGENTS.md`, `CLAUDE.md`, `apps/*/AGENTS.md`, `.claude/settings.json`, `.codex/*` | `.rulesync/**`, `rulesync.jsonc`; `pnpm agent:check` and the `agent-config drift check` |
| `openspec update` | `.agents/skills/.openspec-target`, `.agents/skills/openspec-*`, `.claude/skills/openspec-*`, `.claude/commands/opsx/*` | pinned `@fission-ai/openspec`; the `agent-config drift check` |
| `gh aw compile` | `.github/workflows/*.lock.yml`, `.github/aw/**` | workflow Markdown, `shared/**`, `aw.json`; `tooling/check-gh-aw-drift.sh` |

The exact output paths are owned by `rulesync.jsonc`, the pinned OpenSpec package, and the gh-aw configuration. The root summary is an agent-facing obligation, not a second procedure. The existing drift checks verify the generators themselves; the summary stays deliberately short, and human review checks it when a generator changes.

**Alternative considered:** keep the full table in root, proposal, and design. Rejected: three copies with no check is the defect the review found. The proposal now references this design instead of repeating the table.

### D9 — Document scope and change policy (H4)

Each of the six long-lived governance or operational documents R08 creates or edits opens with a four-field block:

```
## Scope and change policy

- **Owns:** the topics this document is the operational owner of.
- **Does not own:** the adjacent topics and their owners.
- **Intake:** what may be added and what approval it needs; a new normative threshold goes to the spec first.
- **Outflow:** when content leaves, where it goes, and how inbound links are kept working.
```

Example for `docs/BRANCHING.md`:

```
## Scope and change policy

- **Owns:** long-lived branch responsibilities, the protection table, approvals and merge
  methods, task-branch discipline, promotion, sync-back, and hotfix steps.
- **Does not own:** the normative branch rules (`openspec/specs/release-branching/spec.md`),
  the enforced ruleset state (`.github/rulesets.expected.json`), or CI scope and workflow
  mechanics (`docs/CI.md`).
- **Intake:** operational steps and troubleshooting that implement the normative rules. A new
  required context or merge-method restriction enters the spec and the codified ruleset first.
- **Outflow:** when a section becomes normative it moves to the spec; when it becomes CI
  mechanics it moves to `docs/CI.md`. Update the index row and keep old links working.
```

Applicability boundary:

- **Required:** `DESIGN.md`, `REVIEW.md`, `docs/BRANCHING.md`, `docs/CI.md`, `docs/DEFINITION-OF-DONE.md`, `docs/release/VERSIONING.md`.
- **Recommended later:** `docs/LOCAL-SETUP.md` and the per-app development guides when next substantially revised.
- **Exempt:** `README.md` (entry and map), `docs/README.md` (index; one-line routing scope only), change artifacts and evidence under `openspec/changes/`, generated files, historical records, and scoped `apps/*/AGENTS.md`.

The document header owns the detailed scope; the index only routes. Human review checks that the four labels exist and are accurate. H4 was approved on 2026-10-26; this block is the approved target.

**Alternative considered:** apply the block to every document under `docs/`. Rejected: historical evidence, generated material, and narrow guides would carry boilerplate that itself rots.

### D10 — Prerequisites and delivery order

The dependency chain is:

```
F05 → D06 → R08
```

- **F05** corrects the README repository map, including the `apps/mobile` row. R08's root deletes its own map and points at README, so without F05 Mobile disappears from the map.
- **D06** adds `DESIGN.md` §10.1/§10.2 in the archived optional form, the root optional-demo checkpoint, the `REVIEW.md` no-finding clause, and a `change-verification` delta (approved and implemented in PR #393; archived in PR #394). R08 delegates the UI checkpoint and acceptance there; without D06 those pointers dangle.
- **R08** is this change. It creates `docs/BRANCHING.md`, the DoD, and VERSIONING; splits CI; rewrites root and scoped rules; and adds the `change-verification` delta.
- **I09** is an independent follow-up, not part of the chain. It adds `docs/README.md` as a human documentation entry point. R08 does not depend on it. If I09 is re-authored on the delivery base, adding a `docs/BRANCHING.md` row and splitting the CI/branch routes is editorial work verified by human review.

D06's `change-verification` delta is an ADDED requirement; R08's is a MODIFIED requirement in the same capability. Two active deltas for one capability collide at archive. Sequence D06's archive before R08's, or archive both in one docs pull request with reconciled blocks. R08 implementation can start after D06's task merge; R08 archive waits for D06's archive.

H3 is decided: R08 sequences after F05 and D06 and does not absorb their content. D06 was separately approved, implemented with the demo as an optional requirements-discovery step, and archived on 2026-10-26; the section 3 gate is satisfied.

### D11 — The meta-spec states layers and obligations, not document paths

`agent-rule-governance` keeps the layer model, the root and scoped rule contracts, generated-artifact ownership, verification-policy consistency, the scope-header requirement, and the preserved constraints. It names the stable owners (`AGENTS.md`, `docs/DEFINITION-OF-DONE.md`, `openspec/specs/change-verification/spec.md`, `DESIGN.md`, `REVIEW.md`) and uses layer terms elsewhere. The documentation index owns the concrete topic-to-path routing, so moving a document updates the index rather than the meta-spec.

Some paths remain in the spec because they are stable repository contracts: `openspec/specs/`, `DESIGN.md`, `AGENTS.md`, and the generated artifacts. `docs/BRANCHING.md` and `docs/CI.md` appear in this design and in the scope-header requirement's applicability list, not as the definition of the branch layer.

**Alternative considered:** drop `agent-rule-governance` entirely and let the index be the only owner. Rejected: the index routes; it does not state the layer rules or the preservation constraints. A thin meta-spec is the normative owner for those.

## Target file specifications

### `docs/BRANCHING.md` (new)

```
# Branching and protection

## Scope and change policy            (H4 block; example in D9)

## Branch protection and required contexts
   - the three long-lived branches with a one-line operational responsibility each;
     the normative per-branch contract is openspec/specs/release-branching/spec.md
   - the heading, branch-policy intro, protection table, and approval-policy sentences
     moved from docs/CI.md:7-21, heading unchanged
   - the gate-job contract and the approval paragraph's main suite-gate sentence stay
     in docs/CI.md
## Reviews and merge methods
   - one non-author approval; code-owner review on dev
   - merge-commit-only on beta and main; why rebase/squash fail the sync-back discipline
   - the human administrator merges promotion, sync-back, and hotfix pull requests
   - the moved approval-policy sentences explain promotion approval as the release decision
     and hotfix approval as the content review
## Task branches
   - one task = one branch = one PR; cut from origin/dev; target dev
   - never commit on dev/beta/main; check the branch before the first edit
   - trivial fixes still take a branch and PR
   - same-capability delta sequencing: link to the OpenSpec obligation in root
## Promotion and sync-back
   - allowed source heads; content review vs release decision
   - conflict re-convergence; sync-back SHA reasoning
   - the beta-to-main exception with no reverse PR
## Hotfix flow
   - cut from the branch that needs the fix; non-author approval; bypass boundary
   - downstream propagation to dev and beta
## Promotion mechanics
   - PR review gate "Expected" hang; /review; self-approval never counts
## Ruleset drift
   - pointer to .github/rulesets.expected.json and the drift workflow in docs/CI.md
```

The per-branch normative rationale ("dev gates individual-change quality", and so on) is not reproduced as a contract; the page gives a one-line operational responsibility per branch and points to `openspec/specs/release-branching/spec.md`. The operational page describes how to satisfy the contract, not why the contract exists.

### `docs/CI.md` (rescoped)

- H1 becomes `# Continuous Integration (CI)`.
- Add the H4 scope block.
- Add one line after the intro: "Branch responsibilities, the protection table, approvals, promotion, sync-back, and hotfix steps live in `docs/BRANCHING.md`. This page owns how CI selects and enforces its checks."
- Remove the branch-policy heading, intro, table, and approval-policy sentences. Leave a one-line pointer to `docs/BRANCHING.md` where the section was.
- Keep: the CI scope-selection intro; the gate-job contract (the terminal-gate and Node.js coverage paragraphs, under a CI-owned heading such as `## Gate job contract`); `## Promotion integrity check`; `## Ruleset state and drift detection`; `## Check ownership`; `## Required configuration check`; `## Review readiness label`; `## Daily full validation`; `## Mobile EAS cloud builds`; `## Release verification`; `## Local verification`.
- Keep the approval paragraph's `main` six-suite-gate sentence with `## Promotion integrity check`; it states gate wiring, not branch policy.
- Do not change the workflow behavior or any required context.

### `docs/DEFINITION-OF-DONE.md` (new)

```
# Definition of Done

## Scope and change policy            (H4 block)

This document owns the operational evidence procedure. The normative requirements are in
openspec/specs/change-verification/spec.md; REVIEW.md enforces them.

## When this applies
  - behavior change: exercised in a running environment; automated checks also run
  - refactor: smoke-level from the diff's touched surface, any related living specs, and the
    app's documented smoke flows (H2 wording)
  - exemption: documentation-, comment-, and typo-scale changes when stated (H1 wording)

## Deriving what to verify
  - with a proposal: delta WHEN/THEN + intent + app smoke flows
  - without a proposal: diff surface + any related living specs + app smoke flows
  - agent-driven wherever possible; human judgment where an agent cannot judge
  - declared gaps are acceptable evidence for agent-executable verification

## Recording evidence
  - validation.md: commands/results, what was exercised, what was not and why
  - PR Test plan summary; template; no-proposal record in the Test plan
  - media via gh --attach; text stands alone

## UI-visible evidence
  - satisfies the verification matrix in DESIGN.md §6
  - records the acceptance required by DESIGN.md §10.2: who, date, adjustments
  - the acceptance procedure and its no-declared-gap rule are owned by DESIGN.md §10.2

## Per-application verification guides
  - Web: docs/web/development.md
  - Extension: docs/extension/development.md
  - API: docs/api/DEVELOPMENT-DOCUMENT-EN.md
  - CLI: docs/cli/DEVELOPMENT.md
  - Mobile: docs/mobile/README.md and apps/mobile/AGENTS.md

## Review
  REVIEW.md's compliance pass enforces this contract; a missing or boilerplate trail is an
  Important finding; a declared agent-verification gap is not.
```

No `Material UX changes` section, no `Mobile changes` section. Those owners are `DESIGN.md` §10.1 and `apps/mobile/AGENTS.md` respectively.

### `DESIGN.md`

D06 supplies §10.1 (material-UX trigger, demo coverage, approval record, and the review no-finding rule) and §10.2 (hands-on acceptance) in their archived optional form. R08 adds two sentences to §10.2:

> This acceptance step has no declared-gap path.

and

> `docs/DEFINITION-OF-DONE.md` records the acceptance evidence; this section owns the procedure.

R08 does not re-author §10.1 or the §6 matrix. It adds the H4 scope block after the H1. D06 is on the base, so the cited sections exist.

### `docs/release/VERSIONING.md` (new)

```
# Package version decisions

## Scope and change policy            (H4 block)

This document owns when an agent asks about version increments and what follows the
decision. Each application's release document owns its channel mechanics.

## When a decision is required
  - full indirect-effects list: shared packages, API contracts, tooling, and configuration
    outside the application directory
  - required for CLI, Extension, or Mobile logic; shipped UI/assets; runtime dependencies;
    native integration; build/package output
  - documentation-only and test-only changes that do not affect shipped behavior or package
    output are exempt
  - Web and API: no package-version increments; release conditions in docs/web/deployment.md
    and docs/api/DEV-AND-CI-EN.md

## Asking the human
  - manifest table: CLI apps/cli/package.json; Extension apps/extension/package.json;
    Mobile apps/mobile/package.json (version, buildNumber, previousBuildNumber)
  - ask once for all affected apps with current version, recommended bump, reason
  - follow an explicit decision already given
  - continue while pending; no metadata change; no assumed answer; report a pending decision

## After the decision
  - approved: same branch and PR; app release constraints; CLI/Extension stable source
    versions and CI channel suffixes; Mobile docs/mobile/release.md and build numbers
  - declined: preserve versions and record the decision
  - signing, uploading, and store publication remain separately authorized
```

### `REVIEW.md`

R08 changes only:

- the compliance-pass DoD pointer from `"Definition of Done" in AGENTS.md` to `docs/DEFINITION-OF-DONE.md`;
- the `Do not report` generated list from the blanket `.claude/`, `.codex/`, `.agents/` directories to the specific generator-owned sets in D8;
- the H4 scope block.

It does not add a material-UX review step; D06 owns the `Do not report` no-finding clause and the archived `change-verification` requirements. R08's edits compose without touching that clause.

### Root `.rulesync/rules/overview.md` → `AGENTS.md`

Target outline and exact obligation text for the changed rules:

- **Intro:** product one-liner; "This file carries non-delegable obligations and pointers only. Each topic's owner is named where the obligation appears; `README.md` owns the repository map."
- **OpenSpec workflow:** "Observable behavior goes through propose → human review of the proposal → implement → archive after merge. Implementation-only changes (refactors, typos, comment or documentation tweaks) may skip the proposal. Review proposals in conversation or local files, never in a pull request. Run `openspec validate --all --strict` before merge." Plus the archive obligation: "The author archives through a docs pull request after the task pull request merges; every `tasks.md` ends with that item. Classify every unchecked task before archiving. Parallel tasks must not carry delta specs for the same capability; changes touching one capability are archived together or sequenced."
- **Design checkpoints:** "A material UX change offers an optional requirements-discovery demo before dependent implementation: ask the human, recommend it with a specific reason when requirements are uncertain or structural rework is likely, and never treat it as required. When the human accepts, dependent implementation waits, feedback updates the requirements first, and the approval is recorded in the change's `proposal.md` (`DESIGN.md` §10.1); an absent demo or record is not a finding. A UI-visible change needs human hands-on acceptance before the pull request opens (`DESIGN.md` §10.2); that step has no declared-gap path. Demo approval authorizes implementation only."
- **Branches and pull requests:** "One task is one branch and one pull request: cut `<type>/<task-name>` from `origin/dev` and target `dev`. Never commit on `dev`, `beta`, or `main`. Agents never merge promotion, sync-back, or hotfix pull requests. Same-capability delta sequencing: see the OpenSpec obligation above. Mechanics: `docs/BRANCHING.md`."
- **Verification evidence:** "A behavior change is done only when it has been exercised in a running environment and the evidence is recorded per `docs/DEFINITION-OF-DONE.md`. Automated checks must run but never substitute. A declared gap is acceptable evidence where that document allows one; UI hands-on acceptance is not. Documentation-, comment-, and typo-scale changes are exempt when the change states the exemption."
- **Review:** "Read and follow `REVIEW.md`. Run its local pre-push review before pushing any behavior-changing diff. Behavior-changing pull requests carry `OpenSpec: <change-id>`. Close the review loop without waiting for a reminder."
- **Package versions:** "Before committing, pushing, or handing off a change that affects CLI, Extension, or Mobile logic, shipped UI/assets, runtime dependencies, native integration, or build/package output — including indirect effects through shared packages, API contracts, tooling, and configuration outside the application directory — ask the human whether to increment each affected application's version. Documentation-only and test-only changes that do not affect shipped behavior or package output are exempt. See `docs/release/VERSIONING.md`."
- **Generated artifacts:** the three-line summary in D8, plus "Hand edits are rejected by the pre-commit hook and drift checks."
- **Secrets, documentation language, personal local instructions:** keep the existing durable paragraphs, lightly condensed.

The root does not contain a repository map, setup commands, per-branch contracts, promotion/hotfix mechanics, the manifest table, the full evidence-recording procedure, the per-app smoke list, or the material-UX record fields.

### Scoped rules

`.rulesync/rules/web-design.md`:

- Use `styles/theme.tokens.css` for core `--slax-*` runtime values and `app/assets/styles/fork.tokens.css` for Web-only business semantics.
- New core-shell and reading UI must support light, dark, and e-ink. Check the theme-support matrix (`DESIGN.md` §4.2, §6) before assuming a legacy fork surface supports every theme.
- Keep selectors and media queries out of `theme.tokens.css`; that file is also injected into article-preview contexts.
- UnoCSS is a selective bridge. Do not add a utility mapping for every token automatically.
- Avoid new raw colors when a matching semantic token exists; renderer, brand, chart, and documented fixed-profile exceptions remain allowed (`DESIGN.md` §5.1–§5.2, §9).
- Do not inject external SVG markup directly. Curate and validate runtime icons, preserve `viewBox`, and apply the accessibility contract in `DESIGN.md` §7.
- Treat `docs/design/reference/` as visual evidence only. Existing Vue code may contain migration debt and does not override the contract.

`.rulesync/rules/extension-design.md`:

- The Extension is currently a compact, fixed-dark profile with application-owned styles (`DESIGN.md` §4.3).
- Do not import Web theme tokens or replace Extension values with Web values by default.
- Introduce Extension-owned semantic variables when new colors or dimensions repeat or express a stable role; token selection follows `DESIGN.md` §5.1.
- Preserve compact density, focus visibility, accessible names, and touch/pointer usability; icons and accessibility follow `DESIGN.md` §7.4.
- Do not inject external SVG markup directly. Curate runtime icons and apply the import and accessibility boundaries in `DESIGN.md` §7.3–§7.4.
- Treat `docs/design/reference/` as visual evidence only, not an implementation package.

`.rulesync/rules/design-system.md`:

- `DESIGN.md` owns semantic intent, application profiles, exceptions, the material-UX demo checkpoint (§10.1), the hands-on acceptance procedure (§10.2), the verification matrix (§6), and the design change workflow.
- Runtime token and style files own executable values for their application.
- `docs/design/reference/` is non-normative provenance material and must not be treated as a runtime asset package.
- Keep the Web and Extension profiles separate; do not apply Web theme values to the Extension by default.
- Any visible or accessibility-affecting change follows the repository OpenSpec workflow.

`.rulesync/rules/mobile-architecture.md` keeps every native-acceptance detail. Only the evidence pointer changes:

- before: `(see "Definition of Done" in the root rules)`
- after: `(see docs/DEFINITION-OF-DONE.md for evidence recording)`

### Pull-request surface and OpenSpec config

- `.github/PULL_REQUEST_TEMPLATE.md`: the Test plan comment points at `docs/DEFINITION-OF-DONE.md`; the exemption line includes comments; the refactor line includes related living specs; the generated-files checklist says "change generated outputs only through their generators", not the blanket directory list. D06 is already applied on this base in its approved optional form and adds no material-UX pull-request-template checklist item.
- `openspec/config.yaml`: the apply guidance pointer changes from "the Definition of Done in AGENTS.md" to `docs/DEFINITION-OF-DONE.md`.
- `REVIEW.md`: see above.

### Generated outputs

The target table is D8. The branch commits the rulesync sources and the regenerated `AGENTS.md`, `CLAUDE.md`, `apps/web/AGENTS.md`, `apps/extension/AGENTS.md`, and `apps/mobile/AGENTS.md`. No `openspec update` or gh-aw output changes. The `agent-config drift check` verifies the result.

### Document scope headers

The template, the `docs/BRANCHING.md` example, and the applicability boundary are in D9. H4 was approved on 2026-10-26; the six documents carry the block, and human review checks label presence and accuracy.

## Verification policy decisions

The human approved option A for H1 and H2 on 2026-10-26. The alternatives below record what was not chosen.

### H1 — Exemption scope

**Recommended (A): include comments everywhere.**

- Root: "Documentation-, comment-, and typo-scale changes are exempt when the change states the exemption."
- DoD: "Documentation-, comment-, and typo-scale changes are exempt when the change states the exemption."
- `change-verification` requirement paragraph: "Documentation-, comment-, and typo-scale changes are exempt when the change states the exemption."
- `change-verification` scenario "Documentation-only change is exempt": unchanged — "a change touches only documentation, comments, or typos".
- PR template: "Documentation-, comment-, and typo-scale changes: write 'n/a' with the reason."

**Alternative (B): narrow all texts to documentation and typos.**

- Root/DoD/requirement: "Documentation- and typo-scale changes are exempt when the change states the exemption."
- Scenario: "a change touches only documentation or typos".
- PR template: "Documentation- or typo-scale changes: write 'n/a' with the reason."

B is a semantic narrowing of the current scenario and needs explicit approval. A is recommended because comment-only changes cannot alter behavior, the current scenario already includes them, and the root's OpenSpec section already lets comment tweaks skip a proposal. Leaving the requirement paragraph at "documentation and typo" would keep the spec internally inconsistent.

### H2 — No-proposal smoke-verification input

**Recommended (A): align up to three inputs.**

- Root: "A refactor records smoke-level verification from its diff's touched surface, any related living specs, and the affected app's documented smoke flows."
- DoD: same.
- `change-verification` requirement: "A change that touches code without altering observable behavior (a refactor) SHALL record smoke-level verification derived from its diff's touched surface, any related living specs, and the affected app's documented smoke flows."
- `change-verification` scenario "Non-behavioral code change is smoke-tested from its diff": adds "any related living specs".
- PR template: "Refactors: state the diff-derived smoke verification (the diff's touched surface, any related living specs, and the app's documented smoke flows)."

**Alternative (B): remove the addition and keep two inputs.**

- Root/DoD: "from its diff's touched surface and the affected app's documented smoke flows."
- Spec and scenario: unchanged from the current two-input text.

A is recommended because a refactor's living specs are the best statement of the behavior it must preserve. B is acceptable if the human wants no normative expansion; it removes a useful input but leaves the spec and DoD consistent.

## Duplication audit

| Root target section | Owner of the detail | Root keeps | Root does not contain |
| --- | --- | --- | --- |
| Repository map | `README.md` (F05) | Nothing; intro pointer | The map |
| Local environment | `docs/LOCAL-SETUP.md`, app guides | Nothing; the app guide is named in the intro | `pnpm` commands, TOML/env rules, setup phases |
| OpenSpec workflow | `openspec/config.yaml`, `openspec/specs/` | Proposal-before-behavior, review location, validation, archive obligations | Per-tool commands, archive step-by-step |
| Design checkpoints | `DESIGN.md` §10.1/§10.2, `REVIEW.md` | Optional-demo trigger, record location, no-gap rule, no-finding rule | Demo coverage fields, acceptance procedure |
| Branches | `docs/BRANCHING.md`, `release-branching` spec | One task/branch/PR, no long-lived commits, agents never merge, same-capability link | Protection table, promotion/sync-back/hotfix steps, gate rationale |
| Verification | `docs/DEFINITION-OF-DONE.md`, `change-verification` spec | Done condition, recording location, declared-gap rule, exemption sentence | Derivation checklist, evidence fields, per-app list |
| Review | `REVIEW.md` | Read it, local pre-push duty, `OpenSpec:` line, close the loop | Pass definitions, Important/Nit calibration, automation operations |
| Versions | `docs/release/VERSIONING.md` | Full trigger including indirect effects, ask-once, no assumption | Manifest table, per-app channel mechanics, approval follow-up |
| Generated artifacts | `rulesync.jsonc`, pinned tools, drift tooling | Three generator classes, outputs, checks | Generator procedure, every output path as policy |
| Secrets | Root | Prohibition and ask-the-human | n/a |
| Documentation language | Root | English rule and existing-document exemption | n/a |
| Personal local instructions | Root | `AGENTS.local.md` precedence | n/a |

The two deliberate full decision rules are the version trigger and the exemption sentence. They are one line each, and they are the minimum an agent reading only the root needs to avoid a behavior change. Everything else is a pointer.

## Material wording changes

The comparison is the old R08 target (`e8d7c422`) against this revision, with the delivery base (`773d6093`) as the reference where relevant.

| # | File | Old R08 target | R18 target | Why |
| --- | --- | --- | --- | --- |
| W1 | Root | "including indirect effects through shared packages" | Full list: shared packages, API contracts, tooling, and configuration outside the application directory | Restores the base scope; the narrowed summary changed behavior |
| W2 | Root + DoD + spec | Root omitted `comment`; DoD included it; the requirement paragraph omitted it | All texts include `comment` (H1 A) | Unifies four policy texts and the PR template |
| W3 | Root + DoD + spec | Root used the two-input refactor rule; DoD added living specs; the scenario had two inputs | All texts include related living specs (H2 A) | Removes the DoD's extra-normative input by aligning the spec |
| W4 | Root | Root carried the material-UX trigger, the record-location obligation, the mandatory-demo review consequence, and a §10.1 pointer | Same obligation in the archived optional form: offer, feedback-first wait, record location; absence is not a finding; no coverage fields or procedure; `DESIGN.md` §10.1 owns the record contract | Keeps the optional checkpoint without a second copy of the record contract |
| W5 | Root | Root restated the acceptance procedure and the no-gap rule | Root states the obligation and the no-gap consequence; `DESIGN.md` §10.2 owns the procedure; DoD records evidence | Removes the procedure copy |
| W6 | Root | Three-row generated table with sources and checks | Three-line summary; machine configuration authoritative; human review checks the summary | Removes the third copy without losing the obligation |
| W7 | `web-design.md` | "must support light, dark, and e-ink where the theme-support matrix requires it" | "must support light, dark, and e-ink. Check the theme-support matrix (§4.2, §6) before assuming…" | Restores the imperative; the pointer supplements it |
| W8 | `web-design.md` | Pointer-only raw-color rule | "Avoid new raw colors when a matching semantic token exists; … exceptions remain allowed (§5.1–§5.2, §9)." | Restores the imperative |
| W9 | `web-design.md` | "Icons and accessibility follow §7" | "Do not inject external SVG markup directly. Curate and validate runtime icons, preserve `viewBox`, and apply the accessibility contract in `DESIGN.md` §7." | Restores the prohibition |
| W10 | `extension-design.md` | "New repeated colors or dimensions should become Extension-owned semantic variables" | "Introduce Extension-owned semantic variables when new colors or dimensions repeat or express a stable role; token selection follows §5.1." | Restores the imperative and the stable-role trigger |
| W11 | `extension-design.md` | SVG bullet removed | "Do not inject external SVG markup directly. Curate runtime icons and apply the import and accessibility boundaries in `DESIGN.md` §7.3–§7.4." | Restores the prohibition |
| W12 | `VERSIONING.md` | Web/API conditions "covered by `docs/CI.md`" | Owned by `docs/web/deployment.md` and `docs/api/DEV-AND-CI-EN.md`; `docs/CI.md` owns gate mechanics only | Corrects a false pointer |
| W13 | `DESIGN.md` §10.2 | D06 text without the no-gap sentence | Adds "This acceptance step has no declared-gap path." and the DoD recording pointer | Makes the procedure owner state the hard rule |
| W14 | DoD | Had `Material UX changes`, `Mobile changes`, and `Review enforcement` sections | Removed; pointers to `DESIGN.md` §10.1, `apps/mobile/AGENTS.md`, and `REVIEW.md` | Removes three-way duplication |
| W15 | `docs/CI.md` | `# CI scope selection` | `# Continuous Integration (CI)` | Expands the abbreviation; filename unchanged |
| W16 | Six documents | No scope block | H4 four-field block | Prevents scope creep; H4 decides |

## Preserved hard constraints

| Constraint | Owner after R08 | Check |
| --- | --- | --- |
| Optional material-UX demo: when accepted, feedback updates the requirements first and the approval is recorded before dependent implementation | `DESIGN.md` §10.1 (D06); root obligation | Absence is not a finding (D06's archived optional semantics); `REVIEW.md` reports no finding |
| Demo approval authorizes implementation only | `DESIGN.md` §10.2; root sentence | Hands-on acceptance still required |
| Human hands-on acceptance before the PR opens, no declared-gap path | `DESIGN.md` §10.2; DoD records evidence | `change-verification` scenario; `REVIEW.md` step 5 |
| Mobile native acceptance with evidence | `apps/mobile/AGENTS.md`; `change-verification` scenario; DoD links the guide | Native evidence in `validation.md` |
| OpenSpec proposal reviewed before observable behavior | Root OpenSpec obligation | `REVIEW.md` compliance pass |
| `OpenSpec: <change-id>` in behavior-changing PRs | Root review obligation | `REVIEW.md` compliance pass |
| Version decision request, no assumption while pending | Root version obligation; `docs/release/VERSIONING.md` | Task/PR summary records the decision or pending state |
| One task = one branch = one PR; no long-lived commits; agents never merge promotion/sync-back/hotfix | Root branch obligation; `docs/BRANCHING.md` | Rulesets and pre-commit hook |
| Secrets prohibition | Root | Tooling and rule |
| Generated files only through generators | Root summary; machine configuration | `agent-config drift check`, lefthook, gh-aw drift |

## Dependencies and delivery sequence

### Prerequisites

| Change | Branch and commit | What R08 uses | If absent |
| --- | --- | --- | --- |
| F05 | `feat/fix-governance-documentation-facts-f05` at `c8e34890`; merged in PR #392 | README repository map with `apps/mobile` and `packages/reader-embed`; "all Slax Reader code" wording; removed duplicate API paragraph | The root deletes its map and README lacks the Mobile row, so Mobile disappears from the map |
| D06 | Preserved pre-approval branch `feat/add-material-ux-demo-review-d06` at `02f80058`; approved and implemented in PR #393, archived in PR #394 | `DESIGN.md` §10.1/§10.2 in the archived optional form; the `REVIEW.md` no-finding clause; the root optional-demo checkpoint; the archived `change-verification` requirements | Root and DoD pointers dangle; the optional-demo semantics are missing |

F05's diff: `README.md` (`apps/mobile`, `packages/reader-embed`, `deploy/`, `docs/`, `tests/e2e`, `tooling/` rows; "all Slax Reader code") and four API docs (Node range). D06's approved implementation (PR #393): `.rulesync/rules/overview.md` and generated files, `DESIGN.md` (§10.1/§10.2), `REVIEW.md` (the no-finding clause), `.github/PULL_REQUEST_TEMPLATE.md` (removes the pre-approval mandatory item), `openspec/config.yaml` (optional-demo guidance), `openspec/specs/change-verification/spec.md` (four added requirements), and its own change directory.

### I09 documentation index (independent)

I09 (`d7057cf6`) adds `docs/README.md` as a human documentation entry point. It is not a prerequisite for R08 and R08 does not depend on it. If I09 is re-authored on the delivery base, the useful editorial updates are:

- add a direct `docs/BRANCHING.md` row;
- split the combined CI/branch route into CI mechanics (`docs/CI.md`) and branch protection/promotion (`docs/BRANCHING.md`);
- add the DoD and VERSIONING rows if they are missing.

That work is verified by human review.

The branch table is verified by human review against `.github/rulesets.expected.json`; scope headers, if H4 is adopted, are verified by human review against the document's own scope.

### Delivery order and archive gates

1. F05 task PR merges; its content reaches the base.
2. D06 task PR merges; D06's `change-verification` delta is archived.
3. R08 implementation starts; R08 task PR merges.
4. R08 archive waits for D06's archive. If D06's archive is delayed, archive both changes in one docs PR with reconciled `change-verification` blocks.
5. I09 is an optional independent follow-up. If it is re-authored, its own task PR handles the index editorial work; it is not a gate for R08.

R08 must not be implemented on the old chain (`4ed2618f`..`e8d7c422`). It is re-authored on the delivery base after F05/D06.

**Rejected alternative (history).** H3 was decided as sequencing; the self-contained option was not chosen. It would have absorbed the minimal F05/D06 edits: two README lines, `DESIGN.md` §10.1/§10.2 in their pre-approval mandatory form, the pre-approval `REVIEW.md` step and PR-template item, and the root checkpoint. Sequencing was chosen because it avoids a second copy that must be removed when D06 lands.

## Risks / Trade-offs

- **The root still states two decision rules in full.** The version trigger and the exemption sentence are duplicated with their owners. Mitigation: one line each; they are decisions, not procedures; the duplication audit names them.
- **The DoD alone is not a complete UI checklist.** An agent must follow `DESIGN.md` §10.2 and the app guide. Mitigation: the DoD links directly to both, and the root obligation names the no-gap rule.
- **Scoped imperatives can drift from `DESIGN.md`.** Mitigation: every scoped rule cites a section; the delta spec makes a bare pointer a compliance defect; review checks the cited section exists.
- **The branch/CI split adds a file and a hop.** Mitigation: the root and the index route to `docs/BRANCHING.md`; `docs/CI.md` keeps a one-line pointer; human review checks the links.
- **The prerequisite chain makes R08 unable to ship alone.** Mitigation: H3 records the self-contained alternative; the dependency table names exactly what would be absorbed.
- **The scope-header block can become boilerplate.** Mitigation: four fields, short; human review judges whether the scope is real.
- **H1/H2 change normative text.** Mitigation: they are explicit adjudication items with exact wording; the delta spec carries the recommendation and is edited if the human chooses otherwise.
- **The meta-spec can hardcode paths.** Mitigation: D11 keeps layer terms in the spec and lets the index own routing.
- **The old implementation's content is still on branches and could be mistaken for the plan.** Mitigation: the status section states it is superseded; the tasks require re-authoring, not re-applying.

## Verification of this revision

- `git rev-parse recovery/base` → `773d60938c9e2d21a088155a436007e87de31147`.
- `git rev-list --left-right --count origin/dev...recovery/base` → `0	10`; the base is ten commits ahead of `origin/dev` (`9188be24`).
- `git branch -a --contains e8d7c422` → the preserved R08, I09, and lifecycle branches and `recovery/before-sdlc-repair`; not `dev`, `beta`, or `main`.
- File checks in the base: `docs/BRANCHING.md`, `docs/README.md`, `docs/DEFINITION-OF-DONE.md`, and `docs/release/VERSIONING.md` are absent; `DESIGN.md` has no `### 10.1`/`### 10.2`; `REVIEW.md` has no material-UX step; `README.md:25` says "all non-mobile".
- Branch checks: F05 `c8e34890`, D06 `02f80058`, R08 `e8d7c422`, I09 `d7057cf6`; the diffstats in § "Dependencies" come from `git diff --stat` against each branch's merge-base with the base.
- I09 is an independent follow-up: `docs/README.md` is absent from the base.
- `openspec validate --all --strict` and `git diff --check` results are recorded in `validation.md`.

## Migration Plan

1. The human approved the revision on 2026-10-26 with H1–H4 as recommended. The record is in `proposal.md` § "Approval record".
2. Prerequisites: F05 merged in PR #392; D06 was separately approved, implemented in PR #393 with the optional requirements-discovery form, and archived in PR #394. Both are on the delivery base (`dev` at `751e337b`), so section 3 is satisfied.
3. Re-author the root and scoped rules, create `docs/BRANCHING.md`, the DoD, and VERSIONING, split `docs/CI.md`, update `REVIEW.md`/PR template/`openspec/config.yaml`, and add the H4 blocks.
4. Run `pnpm agent:sync`, `pnpm agent:check`, `pnpm exec openspec validate --all --strict`, and `git diff --check`; record the results in `validation.md`.
5. If I09 is re-authored, update the index rows as editorial work; no automated checker is planned.
6. Archive R08 after D06's archive; I09, if re-authored, archives in its own follow-up.
7. Rollback: revert the docs/rules commit and restore the base root; no runtime, data, dependency, deployment, or package-version migration applies.

## Open Questions

None. H1–H4 were decided on 2026-10-26; the exact wording for each choice is in § "Verification policy decisions" and D9. D06's approval was recorded separately and its implementation and archive completed (PR #393, archive PR #394); no prerequisite remains open.
