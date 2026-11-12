# Design

## Context

The existing Nitro public-assets configuration serves a shared Play-only JSON document. The approved local debug APK uses package `com.slax.reader` and its own signing certificate. See proposal.md for authorization.

## Goals / Non-Goals

Select one environment-specific static asset with the existing build profile. Do not add runtime routes, auth policies, secrets, or a generalized asset framework. The local API fixture trusts the matching public debug origin only for physical testing; remote API configuration remains operator-managed.

## Decisions

Place the test-certificate override under `apps/web/public-preview/.well-known/assetlinks.json` and prepend that directory only when existing `getEnv()` returns `preview`. Nitro's actual asset copier preserves the first matching output path, so the default public directory continues serving all other files, including unchanged AASA. Local development, beta and production do not include the override directory. Keep Play trust alongside the one approved test certificate on preview (`r.slax.dev`).

Alternatives were changing the shared JSON (would trust debug in production), adding an HTTP handler (unnecessary runtime boundary), or rewriting generated output after compilation (unnecessary generation and compression concerns). A single conditional asset-directory entry preserves the static serving design.

## Risks / Trade-offs

The added debug certificate permits test-domain (`r.slax.dev`) credentials to that explicitly signed package. Its private signing file remains local and gitignored; only the fingerprint is published. Changing the local signing key requires a separately reviewed public association update. Validate actual config selection and Nitro copying for all four profiles, plus anonymous JSON serving in the Pages runtime. The operator merges the Draft PR before device validation continues; removing the preview override rolls back this additional trust.

The Web release script already maps `TARGET_BRANCH=dev` to `SLAX_ENV=preview` and host `r.slax.dev`. Use that existing mapping when verifying asset selection. `development` describes the local Web server, not the public test domain. Non-Play Android packages use the test domain as clarified by the requester; their signing origin still needs the matching explicitly approved certificate.

The test-certificate association can remain while the same signed test package is used. After testing, an explicit follow-up can remove the test fingerprint while preserving Play trust. Do not revert all association support or change iOS/Beta/production as part of that cleanup. No automatic rollback is scheduled.
