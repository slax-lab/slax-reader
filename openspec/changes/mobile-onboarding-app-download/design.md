# Design

## Context

The onboarding hero currently derives its steps from browser-extension and pinned-extension detection. The Web app already has a client-safe `isMobileBrowser` helper that covers Android, iPhone, iPad, legacy mobile user agents, and iPadOS desktop-style user agents. The official Slax Reader Reader page exposes the iOS App Store and Google Play URLs used by this change.

## Goals / Non-Goals

**Goals:**

- Select a mobile-specific hero before extension detection can produce desktop instructions.
- Route iOS/iPadOS and Android users to their official store listings in a new tab, with the Reader page as a safe fallback.
- Make the mobile exit action visible and reuse the existing account-scoped dismissal state and return navigation.
- Keep desktop behavior, extension detection, and existing onboarding completion semantics unchanged.

**Non-Goals:**

- Adding a native app deep-link or install-status detector.
- Changing the automatic onboarding eligibility rules or API contracts.
- Rebuilding the public Reader download page.

## Decisions

1. **Branch the existing hero by mobile browser status.** The parent page and KOC gate remain unchanged. The hero computes a mobile branch using the existing environment helper, so desktop step logic remains isolated and no extension detection is required for mobile presentation.

2. **Use a small platform URL selector.** The selector runs only on the client, handles iPadOS desktop-style user agents with the existing touch fallback, and returns one of the two verified store URLs or the Reader page fallback. A normal anchor with `target="_blank"` and `rel="noopener noreferrer"` provides the requested new-tab behavior without popup-only logic.

3. **Reuse the existing top exit event.** The mobile close control emits the hero's existing `skip` event. `onboarding.vue` already calls `setDismissed()` before navigating to `kocFlow.returnTarget('/')`, preserving the current per-account marker and campaign-aware return behavior.

4. **Keep mobile copy separate from desktop extension copy.** New locale keys describe the app path and the manual close action. Desktop keys and screenshots remain unchanged.

## Risks / Trade-offs

- [Risk] User-agent classification can be incomplete for uncommon mobile browsers → use the official Reader page fallback instead of guessing a store.
- [Risk] A new tab may be blocked by browser policy → use a standard user-activated anchor; the fallback URL remains visible as the link destination.
- [Risk] A mobile user may have a desktop-class extension-capable browser → mobile presentation follows the requested device experience and avoids unusable extension instructions.
- [Risk] Existing mobile positioning may hide the top control → place the mobile close action within the hero's visible content flow and verify at the 768px breakpoint.

## Migration Plan

No data migration is required. Deploy the Web bundle with the new locale keys and mobile branch. Rollback is a normal Web bundle rollback; existing dismissal markers and desktop onboarding state remain compatible.
