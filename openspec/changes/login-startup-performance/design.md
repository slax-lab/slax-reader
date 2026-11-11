# Design

## Context

The production reference uses a client-rendered login card. Local traces show successive import rounds before the card can mount. The active KOC continuity contract requires the root Inbox URL. The active public-page-startup contract preserves authenticated PowerSync initialization without another serial runtime download.

## Goals / Non-Goals

**Goals:** Reduce resource dependencies before login mounts. Keep authentication, locale selection, campaign continuation, and the appearance of the existing card.

**Non-Goals:** A new UI, production logging, changes to backend contracts, or a redesign of PowerSync account ownership and initialization.

## Decisions

- Render the existing login content through the lightweight shared Web shell as part of the login route. Keep shell locale, theme, token refresh, and channel behavior shared with the default layout.
- Use conditional async imports for the invitation and in-app browser hint. Render both outside the login card's suspense dependency.
- Use the client build manifest to preload the login route's static imports and styles in the login document. Traverse only static imports and exclude resources Nuxt already includes in the application entry hints. Replace generic prefetch links on the login document with these route-specific hints.
- Keep the existing Inbox alias and cache key on a small page component. Resolve the view through an async component after routing. Both entry URLs share the same component and route metadata.
- Enable i18n message prerendering. Read the generated locale paths from the build and expose them through HTML fetch preload links on the root and login documents. Both locale files are eligible so language detection stays with i18n. Match the preload request mode and URL to i18n's fetch.
- Inspect PowerSync's static dependency paths independently. A shipping lazy split requires evidence that it removes public downloads and preserves the authenticated startup contract.

## Risks / Trade-offs

- An authenticated Inbox can start the view request later than before. Compare the request order and ensure the same campaign URL and KeepAlive identity are retained.
- Early locale delivery can fetch a second language. Check response size, reuse, and the effect on login card timing in matched local builds.
- The login document's resource hints also apply to a signed-in visitor who will be redirected. Keep the extra downloads confined to the login document.
- A login route shell has its own mount lifecycle. Verify language, theme, invitation, hint, and normal authenticated transitions.
