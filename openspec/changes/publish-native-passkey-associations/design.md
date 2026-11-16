# Design

## Context

The two well-known URLs currently fall back to Web HTML. See proposal.md for the authorized split from phase-two authentication. Website association is needed before signed native Passkey acceptance can finish.

## Goals / Non-Goals

Publish credential-association statements for the confirmed main app on the existing three Web environments. This change has no interactive UI or native/API/session implementation and does not authorize a new URL-handling feature.

## Decisions

Use two static files in `apps/web/public/.well-known/`, which the existing Nitro/Pages build already publishes. Use exact Nitro route-header rules for JSON, including extensionless AASA. A new server endpoint, Worker, redirect or authentication exemption is unnecessary: public static assets already bypass the app client router and session middleware.

Use `8G3A932HJG.app.slax.reader` for Apple and `com.slax.reader` with the confirmed Play certificate SHA-256 for Android. Declare only Android `delegate_permission/common.get_login_creds`; URL handling belongs to a later feature. The public files are identical across `r.slax.dev`, `r-beta.slax.com` and `r.slax.com`; domain separation is provided by their HTTPS hostnames and the feature's per-environment RP configuration.

## Risks / Trade-offs

[Different local APK signing certificate] → This association authorizes the confirmed Play-distributed identity only; a differently signed test build needs an explicitly reviewed additional development identity.

[Files not yet deployed or stale platform cache] → Verify each public URL after its environment release, then perform native acceptance. Local and artifact checks are not claimed as live-domain verification.

## Migration Plan

Merge the supporting PR into dev through human review, then use existing human-reviewed promotion/release flow for beta and production. Check both URLs return 200 JSON without redirects on each hostname. Continue the separate Passkey feature's signed-device acceptance after development association is live. A rollback removes these assets/header rules through the normal Web release; it does not migrate user data. Archive only after merge through the normal docs PR.
