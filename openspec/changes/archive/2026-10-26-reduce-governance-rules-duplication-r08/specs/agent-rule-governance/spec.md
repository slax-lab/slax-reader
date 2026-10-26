# Spec Delta

## Purpose

Define how the repository's governance content is layered and owned: normative specs, operational documents, machine contracts, agent entry files, and a documentation index each have one owner per topic; root and scoped agent rules carry obligations, pointers, and imperatives rather than copied procedures; generated artifacts are generator-owned; verification policy stays consistent; and deduplication preserves the repository's hard constraints.

## ADDED Requirements

### Requirement: Governance authority is layered

The repository SHALL organize governance content into five layers, and within each layer each topic SHALL have exactly one owner:

1. **Normative.** Files under `openspec/specs/` state SHALL/SHALL NOT requirements and WHEN/THEN scenarios. The root `DESIGN.md` is the normative owner of UI design content. Normative documents SHALL NOT contain commands, troubleshooting, or operational steps.
2. **Operational.** Long-lived operational documents — under `docs/` and the root review policy `REVIEW.md` — state procedures, commands, and troubleshooting. They MAY summarize and link to a normative requirement, but SHALL NOT create, change, or weaken a normative threshold.
3. **Machine contract.** Codified configuration and tooling — the expected ruleset state, generator configuration, pinned tool versions, and drift checks — state the executable contract. Prose policy SHALL NOT be its source of truth.
4. **Agent entry.** The root agent rules and the scoped application agent rules state non-delegable obligations, pointers, and scoped imperatives. They SHALL NOT carry detailed procedures.
5. **Index.** The documentation index maps each governance topic to its owner and layer. It SHALL NOT restate a rule.

A topic MAY appear in more than one layer because each layer answers a different question. Within a layer, a second document SHALL NOT state the same rule as a parallel source of truth.

#### Scenario: A branch question resolves across layers

- **WHEN** an agent needs to know what the branch contract is, how to carry it out, what enforces it, or where to start
- **THEN** the normative rule comes from the release-branching spec, the operational steps from the branch document, the enforced values from the codified ruleset state, the obligation from the root agent rules, and the route from the documentation index — and none of them is treated as another's source of truth

#### Scenario: An operational document tries to set a threshold

- **WHEN** an operational document introduces a new required context, merge-method restriction, or verification threshold
- **THEN** the requirement enters the owning normative spec first, and the operational document only describes how to satisfy it

#### Scenario: Two documents in the same layer disagree

- **WHEN** two governance documents in the same layer state different rules for one topic
- **THEN** the designated owner's rule applies and the other document is corrected to point at it

### Requirement: Root agent rules carry non-delegable obligations and pointers only

The root `AGENTS.md`, generated from `.rulesync/rules/overview.md`, SHALL contain the obligations an agent must not delegate, and for each obligation the owner of its procedure. It SHALL NOT contain:

- per-branch protection contracts, or promotion, sync-back, and hotfix mechanics;
- the verification-recording procedure or the per-application smoke-flow list;
- the package-version manifest table or the full decision procedure (the root MAY state the trigger and the indirect-effects scope as an obligation);
- the repository map or local setup commands;
- the material-UX demo record fields or the hands-on acceptance procedure;
- a procedure for any generator.

The root MAY name the generator classes, their output sets, and their drift checks in a short summary, because avoiding hand edits is a non-delegable obligation. When a procedure changes, the root changes only if an obligation or a pointer changes.

#### Scenario: A detailed procedure changes in its owner

- **WHEN** a branch, verification, review, design, version, or setup procedure changes
- **THEN** the edit is made in the owning document, and the root rules change only if a durable obligation or pointer changes

#### Scenario: A root edit restates an owned procedure

- **WHEN** a proposed root-rule edit would restate a procedure owned by another document
- **THEN** the text becomes a pointer to the owner or is rejected as duplication

#### Scenario: A new generated output appears

- **WHEN** a generator starts producing a new path
- **THEN** the generator's machine configuration owns that path and the root summary is updated, without turning the summary into a second procedure

### Requirement: Scoped application rules keep the imperative and cite the normative section

Scoped application agent rules SHALL state the application-specific requirement in imperative mood and SHALL cite the `DESIGN.md` section that governs it. They SHALL NOT reproduce the full `DESIGN.md` rule. Replacing an imperative with a bare section pointer does not satisfy this requirement; the pointer supplements the imperative.

#### Scenario: A Web design rule changes

- **WHEN** a Web design rule changes
- **THEN** `DESIGN.md` is updated with the normative rule, and the scoped file keeps its imperative plus the section reference

#### Scenario: A section pointer resolves

- **WHEN** a scoped design rule cites a `DESIGN.md` section
- **THEN** the cited section exists and contains the rule the imperative depends on

#### Scenario: A scoped file keeps only a pointer

- **WHEN** a scoped design rule replaces an explicit requirement with only a section reference
- **THEN** that is a compliance defect, because an app agent may not read the cited section before acting

### Requirement: Generated agent artifacts have exactly one generator

Rulesync outputs, `openspec update` outputs, and gh-aw outputs SHALL be changed only through their generator or pinned tool version. The root agent rules SHALL name each generator class, its output set, and its drift check in a short summary. The generator's machine configuration SHALL be authoritative for the exact output paths. A generated artifact that differs from its generator's output SHALL be rejected by the pre-commit hook or the CI drift check.

#### Scenario: Agent rules or permissions change

- **WHEN** an agent rule or permission changes
- **THEN** the source under `.rulesync/` is edited and `pnpm agent:sync` regenerates the outputs in the same commit

#### Scenario: A generated artifact is hand-edited

- **WHEN** a generated artifact differs from its generator's output
- **THEN** the pre-commit hook or the CI drift check rejects the change

#### Scenario: An OpenSpec skill file needs a change

- **WHEN** an OpenSpec skill or command file needs to change
- **THEN** it changes through a deliberate `openspec update` tool-upgrade pull request, never by hand

### Requirement: Verification policy texts agree

The root agent rules, `docs/DEFINITION-OF-DONE.md`, `openspec/specs/change-verification/spec.md`, and `.github/PULL_REQUEST_TEMPLATE.md` SHALL state the same verification-exemption scope and the same no-proposal smoke-verification inputs. A change that alters one SHALL update the others in the same change. A disagreement SHALL be treated as a governance defect and adjudicated explicitly; it SHALL NOT be resolved by copying whichever text is convenient.

#### Scenario: The exemption scope changes

- **WHEN** a change adds or removes a category from the verification exemption
- **THEN** the root rules, the Definition of Done, the normative requirement and its scenario, and the pull-request template state the new scope in the same change

#### Scenario: A no-proposal verification input changes

- **WHEN** a change adds or removes an input for no-proposal smoke verification
- **THEN** the normative scenario, the Definition of Done, the root rules, and the pull-request template agree

#### Scenario: The texts disagree

- **WHEN** two of the policy texts state different exemption scopes or different no-proposal inputs
- **THEN** the change records an explicit adjudication and resolves every text, rather than leaving a known mismatch

### Requirement: Governance documents declare their scope and change policy

Each long-lived governance or cross-cutting operational document this change creates or edits SHALL open with a scope-and-change-policy statement immediately after its H1. The statement SHALL name:

- **Owns:** the topics the document is the operational owner of;
- **Does not own:** the adjacent topics and their owners;
- **Intake:** what content may be added and what approval it requires;
- **Outflow:** when content leaves, its destination, and how inbound links are kept working.

The documentation index SHALL route readers to the owner without restating the scope. Other long-lived documents SHOULD adopt the statement when next substantially revised. The statement SHALL NOT be required for the repository entry file, the documentation index (which states only its routing role), change artifacts and evidence, generated files, historical records, or scoped application agent rules.

#### Scenario: New content has no scope fit

- **WHEN** a proposed addition to a governance document does not fit the document's stated scope
- **THEN** review reports it, and the content moves to its owner instead of enlarging the document

#### Scenario: Content moves out of a document

- **WHEN** content leaves a document for a new owner
- **THEN** the documentation index is updated and inbound links are kept working or redirected from the old location

#### Scenario: The index restates the scope

- **WHEN** the documentation index repeats a document's detailed scope instead of routing to it
- **THEN** the detailed scope stays in the document header and the index is reduced to a route

### Requirement: Deduplication preserves hard constraints

Reducing duplication SHALL NOT remove or weaken any of these constraints:

- the optional material-UX requirements-discovery demo: when the human accepts it, dependent implementation waits for the feedback, the requirements are updated first, and the approval is recorded in the change's `proposal.md` with the fields `DESIGN.md` §10.1 lists; an absent demo or record is not a Compliance finding and never blocks the merge;
- post-implementation human hands-on acceptance for UI-visible changes before the pull request opens, with no declared-gap path, and with demo approval authorizing implementation only;
- Mobile behavior changes accepted on real Android or iOS targets, with native acceptance evidence recorded in `validation.md`; unit, host, and browser checks alone do not establish acceptance;
- human review of an OpenSpec proposal before implementing observable behavior;
- the `OpenSpec: <change-id>` line in behavior-changing pull requests;
- the per-application package-version decision request, with no assumption made while a decision is pending;
- one task = one branch = one pull request, no commits on `dev`, `beta`, or `main`, and agents never merging promotion, sync-back, or hotfix pull requests;
- the secrets prohibition and the generated-file discipline.

#### Scenario: Material UX demo is declined or absent

- **WHEN** a material UX change has no demo and no demo approval record
- **THEN** review reports no Compliance finding for the absence and the merge gate is not blocked, regardless of which document carries the rule text

#### Scenario: UI acceptance is skipped

- **WHEN** a UI-visible change reaches its pull request without human hands-on acceptance
- **THEN** the pull request is not opened, because no owner relocation may create a declared-gap path for that step

#### Scenario: Mobile acceptance is verified natively

- **WHEN** a behavior change affects the mobile app
- **THEN** acceptance is exercised on real Android or iOS targets and the native acceptance evidence is recorded in `validation.md`; unit, host, or browser checks alone do not establish it

#### Scenario: A deduplication edit weakens a constraint

- **WHEN** a deduplication edit removes or weakens any listed constraint
- **THEN** the edit is out of contract and requires human adjudication before acceptance
