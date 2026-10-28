# Review instructions

## Scope and change policy

- **Owns:** review passes, Important-versus-Nit calibration, the OpenSpec compliance pass, and
  the review treatment of material-UX changes (`DESIGN.md` §10.1).
- **Does not own:** review automation operations — triggers, gates, pausing, budget,
  troubleshooting — which live next to the workflows or in `docs/CI.md`; the
  verification-evidence procedure (`docs/DEFINITION-OF-DONE.md`); the normative verification
  rules (`openspec/specs/change-verification/spec.md`).
- **Intake:** review instructions only. A new normative threshold enters its owning spec first.
  Operational automation documentation does not belong here; report a pull request that adds
  it to this file as a Compliance finding.
- **Outflow:** automation documentation moves next to the workflows or to `docs/CI.md`;
  normative content moves to its owning spec. Update inbound links and keep old links working.

This file is the single source of truth for review policy in this repo. It is read by automated review services, by agents asked to review code, and by human reviewers.

In CI this file is read **from the pull request's head branch**, so a pull request can adjust the policy it is reviewed under — call out any change to this file that weakens the policy as a finding.

## Passes

Run three passes and tag each finding with its pass. Classify each finding as Important or Nit (defined below).

- **Bugs**: logic errors, broken edge cases, subtle regressions
- **Security**: injection risks, authentication gaps, secrets or PII in logs and error messages, and deliberate threats — review the diff as if the author could be malicious: new dependencies without a stated need, obfuscated or encoded payloads, and network calls or file access that could move data beyond the feature's purpose
- **Compliance**: the change matches its linked OpenSpec change artifacts (see below)

## What Important means here

Reserve Important for findings that:

- break behavior or introduce a regression
- lose or corrupt user data (bookmarks, highlights, comments)
- corrupt the shared production database through schema migrations: the beta environment runs migrations against production PostgreSQL before code passes the `main` gate, so any migration that is incompatible with the code currently serving production — dropping or renaming tables/columns, changing column types, adding `NOT NULL` columns without defaults — is Important unless the change demonstrates an expand/contract split; applies when the diff touches a migration family (`apps/api/prisma/pg_migrations/**`, `apps/api/prisma/logs_migrations/**`, `apps/api/prisma/d1_migrations/**`, `apps/api/prisma/d1_migrations/fulltext/**`), `*.sql`, or ORM schema files (e.g. `schema.prisma`)
- leak secrets or PII
- introduce suspected malicious code: a backdoor, covert data exfiltration, or an unvetted dependency with install scripts or unexpected network/file access. Such a finding needs concrete evidence in the diff, not general suspicion; when uncertain, flag it and require a human reviewer's verdict before merge
- break the cross-app API contracts in `packages/contracts`
- diverge from the intent of the linked OpenSpec change

Style, naming, and refactoring suggestions are Nits at most.

## Migration release evidence

Every new migration carries a declaration in its leading comment block and a named API owner approval. The release check verifies that the declaration exists and is complete, that a named owner approved the pull request that introduced the migration, that the release diff did not delete, rename, or edit a released migration, and that a `contract` has prerequisite and deployment evidence. It does not parse SQL, and it never claims a migration is safe. Treat its result as a record of what was declared and approved, not as proof.

The semantic duties stay here. For every migration in the diff, confirm:

- the declared class is honest: `expand` only adds a compatible object, `migrate` preserves the guarantee it names, and `contract` is the delayed removal of an object nothing serves anymore;
- `removes` and `preserves` name the objects the SQL actually touches — the check does not compare them;
- `reason` explains the real operational constraint, not the class;
- for a `contract`, serving code (including dynamic SQL, background jobs, and external consumers) no longer reads or writes the removed object, and the prerequisite release that removed the last dependency is the one the declaration names.

A `contract` is backed by machine evidence: the prerequisite pull request is merged, its `merge_commit_sha` equals `prerequisite-merge`, its body carries the matching `OpenSpec:` trailer, and that commit is contained in `main`, the release head, and the commits behind the latest successful production and beta API deployments. The evidence is pipeline evidence only — confirm that no out-of-band `wrangler rollback` happened since the evidence deployment, or that a pipeline redeploy completed. A rollback the pipeline never recorded is invisible to the check, so this confirmation is a review duty, not a machine guarantee.

A migration file already on `main`, `beta`, or the pinned `dev` adoption commit is frozen: it must not be edited or annotated, because Prisma records its checksum. A migration merged to `dev` after adoption may still change before it reaches a shared branch.

A `hotfix/*` pull request to `beta` or `main` may add only `expand` migrations. A `migrate`, `contract`, or `adjudicated` declaration must ship through a normal release, because a hotfix cannot carry the release its own prerequisite depends on.

The `adjudicated` overlay is exceptional: it applies to a `contract` or `migrate` whose prerequisite cannot be satisfied, requires two named owners with `APPROVED` reviews, an incident reference, a backup reference, a ledger-reconciliation reference, and an adjudication timestamp. It skips only prerequisite and deployment evidence. Confirm the incident justifies it; it is not a routine fourth class.

The approving owner is the accountable reviewer for the class and its claim. An approval that does not engage with the declaration is a finding, and so is a declaration that hides a destructive statement behind `expand`.

## Cap the nits

Report at most five Nits per review; summarize the rest as a count. If everything you found is a Nit, lead the summary with "No Important findings."

## Compliance pass

Run this pass both for local pre-push review and for pull request review.

Pull requests between two long-lived branches — promotion pull requests (`dev` → `beta`, `beta` → `main`) and sync-back pull requests in the reverse direction — are exempt from this pass: their content was reviewed in the constituent task pull requests, the batch has no single change-id, and body references to in-flight evidence on such pull requests are not contradictions. They need no `OpenSpec:` line and no Test plan evidence trail. `hotfix/*` pull requests are not exempt: their content never passed a `dev` review, so they follow this pass like any task pull request.

1. Decide whether the diff changes observable behavior (features, API changes, behavior fixes):
   - Implementation-only changes — refactors, typos, comment/doc tweaks — may skip the OpenSpec proposal, so this pass ends here for them.
   - For a pull request claiming to be implementation-only, verify that its `OpenSpec: n/a` line is present and that the claim is accurate; report an inaccurate `n/a` as an Important Compliance finding.
   - When in doubt, treat a diff that touches `apps/**` or `packages/**` as behavior-changing.
2. Determine the change-id, and state which one you settled on:
   - For a pull request, find the `OpenSpec:` line in the PR body.
   - For a local review there is no PR body. List the active changes in `openspec/changes/` (excluding `archive/`). If exactly one is active, use it. If several are active, match the diff against each change's `proposal.md` and delta specs, and use the one whose intent the diff implements. Only if no change matches, or the match is ambiguous, ask the requester.
   - If no change-id can be determined for a behavior-changing diff, report that as an Important Compliance finding.
3. Read `openspec/changes/<change-id>/`: `proposal.md`, `tasks.md`, `design.md` (if present), and the delta specs under `specs/`.
4. Verify the implementation matches the change's stated intent and that tasks marked complete are actually implemented. Report divergences as Compliance findings.
5. For a behavior-changing diff, check the verification-evidence trail (see `docs/DEFINITION-OF-DONE.md`):
   - For a pull request: the body must follow the repository template and its Test plan must carry a real evidence trail — what was run, what was exercised in a running environment, and what was not verified and why — linking `openspec/changes/<change-id>/validation.md` when the details live there.
   - For a local pre-push review: hold the change directory's `validation.md` (or the diff's stated exemption) to the same standard before pushing.
   - A missing Test plan section, an empty or boilerplate evidence trail, or evidence contradicting observable facts (for example claiming a check that CI shows failing) is an Important Compliance finding.
   - A declared gap ("X was not verified, because Y") is not a finding; whether the declared gap is acceptable is the human reviewer's decision. This clause covers agent-executable verification only — the human acceptance in the next bullet admits no declared gap.
   - For UI-visible changes, the trail must also record the human hands-on acceptance that preceded the pull request (who, when, what was adjusted); its absence is an Important Compliance finding.

## Do not report

- A material UX change's missing demo or demo approval record — the demo is optional and chosen by the human (`DESIGN.md` §10.1); its absence is not a finding and does not block the merge. The UI-visible hands-on acceptance check in the Compliance pass still applies, and an accepted demo's approval does not substitute for it.
- Generated outputs owned by a generator: rulesync outputs (`AGENTS.md`, `CLAUDE.md`, `apps/*/AGENTS.md`, `.claude/settings.json`, `.codex/*`), `openspec update` outputs (`.agents/skills/.openspec-target`, `.agents/skills/openspec-*`, `.claude/skills/openspec-*`, `.claude/commands/opsx/*`), and `gh aw compile` outputs (`.github/workflows/*.lock.yml`, `.github/aw/**`) — their drift is enforced in CI
- OpenSpec structural validity — `openspec validate --all --strict` runs in CI
- `pnpm-lock.yaml`, `node_modules/`, build outputs (e.g. `dist/`)
- Anything else CI already enforces

## Recurring findings

Patterns flagged more than once are tracked here. Before posting a finding, compare it against this list; on a match, tag the finding `[REPEAT]`.

A confirmed `[REPEAT]` may be promoted into the agent rules by a human; agents must never promote patterns into the rules on their own.

| Pattern | First seen | Date | Status |
| --- | --- | --- | --- |
| _example: request bodies logged at info level_ | _#123_ | _YYYY-MM-DD_ | _watching / promoted_ |
