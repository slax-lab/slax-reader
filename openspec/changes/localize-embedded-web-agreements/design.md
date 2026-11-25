# Open the Terms and Privacy documents in the App's active language

## Context

The report saw English agreement bodies in the Chinese iOS login flow. The App opens bare /terms and /privacy URLs; Web already publishes both documents in English and Chinese.

## Goals / Non-Goals

Pass the active App display language on the existing agreement WebView entry and render both the page title and document body in that language.

## Decisions

Add a supported, page-scoped locale hint to the two agreement URLs. Select the matching existing Web content collection on the initial render. Ordinary visits can keep using the normal Web locale. This change reuses the published texts and does not change global account preferences.

## Risks / Trade-offs

The WebView URL handoff is the only native integration in this proposal. Exercise it on the iOS App before acceptance.

## Verification

Use an actual iOS login WebView for the App handoff, plus ordinary browser visits to the same URLs.
