# Proposal

## Why

When Slax Reader is opened from an embedded browser inside WeChat, Instagram, YouTube, or another third-party app, browser capabilities and reading behavior can be restricted. Users need a clear, low-friction instruction to open the same URL in their external browser, while ordinary Safari, Chrome, Firefox, and Edge users must never see an irrelevant warning.

## What Changes

- Add a global, dismissible floating guidance card for eligible third-party in-app browsers.
- Detect only explicit in-app browser markers and a conservative Android WebView marker; unknown or ordinary browser user agents remain hidden.
- Suppress the guidance in the Slax Reader native app, standalone PWA mode, protocol/document pages, and technical callback/bridge routes.
- Provide localized Chinese and English copy and an accessible close button.
- Persist manual dismissal counts in local storage: the first close allows the card to return on the next eligible visit, while the second close starts a one-hour cooldown; keep the card independent from page layout height.
- Add unit and component coverage for positive and negative user-agent cases, exclusions, manual close counting, drag dismissal, cooldown expiry, and rendering.

## Capabilities

### New Capabilities

- `in-app-browser-guidance`: Detect supported embedded browsers and show a localized, dismissible external-browser instruction across eligible Web pages.

### Modified Capabilities

<!-- No existing capability requirements are being modified. -->

## Impact

- Web-only changes under `apps/web/app`, `apps/web/i18n`, and `apps/web/tests`.
- No API, database, authentication, or dependency changes.
- The global default layout gains one client-only guidance component; protocol and technical routes are explicitly excluded.
