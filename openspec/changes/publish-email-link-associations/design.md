# Design

## Context

The existing static documents support Passkeys. The email-link feature is a separate local commit and cannot complete signed-device App Link testing until website URL association is published. See proposal.md for the approved support scope.

## Goals / Non-Goals

Publish only the existing App identities' URL association. API, interactive Web/App flows, native manifests/binaries, user accounts and certificate trust remain in their owning changes.

## Decisions

- Extend the two existing public JSON assets; reuse their existing JSON header rules and normal Web deployment. Apple keeps `webcredentials` and adds an `applinks.details` entry with the exact `/email-login` component.
- Android keeps the entire existing target and credential-sharing relation, adding `common.handle_all_urls`. That relation grants domain-level association; URL path selection belongs to the future native intent filters. This support PR does not claim that Digital Asset Links itself restricts Android paths.
- Keep `/email-login-web` outside Apple's App Link path. The feature's native binary independently limits its Android intent filters to `/email-login`.
- Scope the older Passkey delta's no-URL-handling scenario to a credential-only deployment. Its capability stays in that original delta; this change introduces only `native-email-link-association` and has no duplicate capability delta.

## Risks / Trade-offs

- Platform association caches may delay recognition after publication → verify public HTTPS responses after the human merges, then test signed binaries.
- Public association alone does not install a URL handler → App manifests and link authentication remain part of `add-email-link-auth`.

## Migration Plan

The human merges this support Draft PR into dev; the existing workflow publishes preview at `r.slax.dev`. Beta/main promotions publish the same assets at `r-beta.slax.com` and `r.slax.com`. No agent merge, deployment or promotion is performed. Continue signed-App and real-mail testing afterward. Rollback removes only the new URL association fields while retaining credential association.
