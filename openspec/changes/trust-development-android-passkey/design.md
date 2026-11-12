# Design

## Context

The existing Nitro public-assets configuration serves a shared Play-only JSON document. The approved local debug APK uses package `com.slax.reader` and its own signing certificate. See proposal.md for authorization.

## Goals / Non-Goals

Select one environment-specific static asset with the existing build profile. Do not add runtime routes, auth policies, secrets, or a generalized asset framework. The local API fixture trusts the matching public debug origin only for physical testing; remote API configuration remains operator-managed.

## Decisions

Place the development override under `apps/web/public-development/.well-known/assetlinks.json` and prepend that directory only when existing `getEnv()` returns `development`. Nitro's actual asset copier preserves the first matching output path, so the default public directory continues serving all other files, including unchanged AASA. Preview, beta and production do not include the override directory. Keep Play trust alongside the one approved test certificate in development.

Alternatives were changing the shared JSON (would trust debug in production), adding an HTTP handler (unnecessary runtime boundary), or rewriting generated output after compilation (unnecessary generation and compression concerns). A single conditional asset-directory entry preserves the static serving design.

## Risks / Trade-offs

The added debug certificate permits development-domain credentials to that explicitly signed package. Its private signing file remains local and gitignored; only the fingerprint is published. Changing the local signing key requires a separately reviewed public association update. Validate actual config selection and Nitro copying for all four profiles, plus anonymous JSON serving in the Pages runtime. The operator merges the Draft PR before device validation continues; removing the development override rolls back this additional trust.
