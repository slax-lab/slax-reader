# Validation

## Scope and approval

- On 2026-11-18 the requester approved publishing only website association files in a support Draft PR before resuming App and real-email testing.
- The isolated support branch starts at `origin/dev` commit `1e821fc5`. Only the two existing public association assets change at runtime. OpenSpec records describe that behavior and scope the older credential-only requirement to its original baseline.
- There is no interactive surface or Mobile integration/package output change in this support PR; no UI acceptance or Mobile version decision is needed for this patch. The separately approved Mobile 1.0.33 (808) feature stays on `feat/add-email-link-auth` at `298b19a8`.

## Automated and running verification

Performed on 2026-11-18 against the support branch:

- JSON comparison against `origin/dev`: Apple `webcredentials` and the complete Android target (package and SHA-256 fingerprints) are unchanged. Apple's only new entry is the exact `/email-login` App Link. Android's only new relation is `delegate_permission/common.handle_all_urls`.
- Fresh `pnpm web -- build` with non-secret preview fixture values: passed. Both generated public assets match their source bytes. The generated output has no `email-login.html`, confirming the feature page is absent from this support build. Fixture values are for verification only; this build is not a deployment artifact.
- Served that build through the actual local Cloudflare Pages runtime at port 4299. Anonymous GETs to both well-known paths with each of the three Host headers (`r.slax.dev`, `r-beta.slax.com`, `r.slax.com`) returned HTTP 200, `application/json`, no redirect, and JSON equal to the source: six checks passed. These are local runtime checks, not claims of deployment to the public domains.
- `pnpm exec openspec validate --all --strict`: 150 passed, zero failed.
- `git diff --check`: passed.

Local build/runtime receipts were recorded under `/tmp/slax-email-associations-20261118/` (`web-build.log`, `pages.log`, `http-evidence.json`, `openspec.json`). These local receipts are not required deployment inputs.

## Local pre-push review

Read `REVIEW.md` and reviewed all changed files in its three passes:

- **Bugs:** no Important findings. Both existing credential associations are preserved; Apple matches only the canonical path. Android association is domain-level and does not claim to filter paths; native intent filters remain in the feature change.
- **Security:** no Important findings. Existing public App identities and certificate trust are preserved. No secret, dependency, network code, private configuration, API handler or signing input is introduced.
- **Compliance:** no Important findings. Change ID: `publish-email-link-associations`. Runtime scope matches the approved support request and its scenarios; the historical credential-only scenario is qualified in its owning delta instead of duplicating that capability. This is a public metadata change with running evidence and no UI surface.

## Not yet verified

Public HTTPS publication, platform cache refresh, signed App link handling and actual Resend email delivery are intentionally pending the requester's merge and release. Association metadata alone does not ship native handlers or email-link authentication. After publication, verify the public responses and continue the separate feature's App and real-mail acceptance. This support PR does not merge or deploy anything.
