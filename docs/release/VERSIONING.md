# Package version decisions

## Scope and change policy

- **Owns:** when an agent asks about a package-version increment, how to ask, and what follows
  the decision.
- **Does not own:** each application's channel mechanics and release constraints
  (`docs/cli/RELEASE.md`, `docs/extension/RELEASE.md`, `docs/mobile/release.md`); Web and API
  deployment conditions (`docs/web/deployment.md`, `docs/api/DEV-AND-CI-EN.md`); CI gate
  mechanics (`docs/CI.md`).
- **Intake:** the decision protocol and its manifest table. A new release condition enters the
  owning application's release document first.
- **Outflow:** channel mechanics move to the application's release document; release
  conditions move to the owning deployment document. Update inbound links and keep old links
  working.

Each application's release document owns its channel mechanics. Web and API deployments do not
use package-version increments: their release conditions are owned by `docs/web/deployment.md`
and `docs/api/DEV-AND-CI-EN.md`, not by this document or `docs/CI.md`.

## When a decision is required

- For changes to CLI, Extension, or Mobile logic, shipped UI/assets, runtime dependencies,
  native integration, or build/package output, assess which applications are affected. Include
  indirect effects from shared packages, API contracts, tooling, and configuration outside the
  application directory.
- Documentation-only and test-only changes that do not affect shipped behavior or package
  output are exempt.
- Web and API changes do not use package-version increments. Their release conditions are owned
  by `docs/web/deployment.md` (which maps a merged target branch to an environment and
  destination) and `docs/api/DEV-AND-CI-EN.md` (only a merged PR into `dev`, `beta`, or `main`
  with API-related changes deploys the API). `docs/CI.md` owns the CI gate mechanics, not those
  release conditions.

## Asking the human

- After preparing and validating the changes, before committing, pushing, or handing them off
  as ready, ask the human whether to increment the affected application's `package.json`
  version:

  | Application | Manifest | Version fields |
  | --- | --- | --- |
  | CLI | `apps/cli/package.json` | `version` |
  | Extension | `apps/extension/package.json` | `version` |
  | Mobile | `apps/mobile/package.json` | `version`, `buildNumber`, `previousBuildNumber` |

- Combine affected applications into one question, giving each current version, recommended
  new version or bump type, and reason.
- Follow an explicit version decision already given for this task without asking again.
- Continue implementation and independent checks while the decision is pending, but wait for
  an explicit answer before changing version metadata or finalizing the task. Do not assume
  either approval or refusal. If no answer is available, report the version decision as
  pending.

## After the decision

- **Approved:** update the affected manifests in the same task branch and pull request,
  following each application's release constraints. CLI and Extension keep their stable source
  versions; CI derives channel suffixes. For Mobile, follow `docs/mobile/release.md` and
  regenerate native metadata through the existing tooling.
- **Declined:** preserve the versions and record that decision in the task and pull request
  summary.
- Verify the relevant CI release conditions when explaining the effect of a bump. Version
  approval authorizes the agreed metadata change; signing, uploading, and store publication
  still follow their existing authorization requirements. Mobile CI currently performs checks
  and JavaScript bundle validation only.
