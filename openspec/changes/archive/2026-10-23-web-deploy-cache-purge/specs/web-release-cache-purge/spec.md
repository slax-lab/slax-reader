# Spec Delta

## Purpose

Keep released Web assets fresh at Cloudflare's edge while isolating each environment's cache and credentials.

## ADDED Requirements

### Requirement: Web release environments match target branches

Web releases SHALL select GitHub Environments `dev`, `beta`, and `main` for the corresponding target branches, retaining build profiles `preview`, `beta`, and `production` respectively.

#### Scenario: Production release
- **WHEN** a Web pull request is merged into `main`
- **THEN** publication and cache purging use the `main` Environment, not `prod`

### Requirement: Successful publication purges only its hostname

After confirmed successful Pages deployment, the release SHALL purge all Cloudflare edge cache entries for only `r.slax.dev` on `dev`, `r-beta.slax.com` on `beta`, or `r.slax.com` on `main`. It SHALL use the selected Environment's existing `CF_ZONE_ID` and `CLOUDFLARE_API_TOKEN` Secrets. Missing or malformed zone IDs SHALL stop publication before remote operations. Credentials SHALL remain outside client builds and logs. Whole-zone purging SHALL NOT be used.

#### Scenario: Release succeeds
- **WHEN** Pages confirms the exact published deployment succeeded
- **THEN** the release submits one hostname-scoped purge using that environment's zone and token

#### Scenario: Publication is unsuccessful or skipped
- **WHEN** building, uploading, or final deployment confirmation fails, or the release is superseded
- **THEN** no cache purge is submitted

### Requirement: Purge failures are visible

The release SHALL require HTTP success and JSON `success: true` from the purge API, bound request duration, reject redirects, and fail on errors without exposing credentials or raw response bodies. It SHALL NOT claim that API acceptance proves every cached object was evicted.

#### Scenario: Cloudflare rejects or fails the purge
- **WHEN** the purge request fails, times out, returns malformed JSON, or does not report success
- **THEN** the job fails with a safe diagnostic and cleans temporary publication files without rolling back the deployed version
