# Slax Reader browser extension

[Development and verification](development.md) · [Web architecture](../web/architecture.md) · [Chinese](architecture_CN.md)

The complete Slax Reader browser extension is maintained in one source tree, including the open-source community features and Pro capabilities such as subscription UI, analytics and the local-first bookmark bridge. It does not depend on an external submodule.

## Technology stack

- **Core framework**: Vue 3.5 (`@wxt-dev/module-vue`)
- **Extension framework**: WXT 0.21 (Manifest V3)
- **Build tooling**: Vite 8
- **Styling**: UnoCSS (`@wxt-dev/unocss`) + SCSS
- **Internationalization**: `@wxt-dev/i18n` (en / zh_CN)
- **Analytics**: `@wxt-dev/analytics` + Google Analytics 4
- **Content parsing**: `@slax-lab/readability`
- **Highlighting engine**: `@slax-reader/selection` (workspace package)
- **Browser APIs**: Chrome / Firefox Extensions API (Chrome 115 or newer)

## Pro capabilities

- **Subscription and payment UI**: `components/SubscribeCard.vue` and `components/SubscribePlaceholder.vue`.
- **Local-first bookmark bridge**: lets the Extension read PowerSync data from the Web origin to determine bookmark state without keeping a second bookmark copy:
  - `entrypoints/background/bridgeService.ts` proxies the service worker, keeps the offscreen document alive and passes the session token to its iframe.
  - `entrypoints/offscreen/` hosts an offscreen document with a hidden iframe pointing to `/x/ext-bridge`; it communicates with Web through `postMessage`.
  - `bridge/request.ts` and `bridge/selectionAdapters.ts` adapt requests, replace the `bookmark_id` placeholder with the real `bookmark_uid`, and provide the highlighting engine's bookmark data source.
  - `notifySenderTabWhenReady` in `entrypoints/background/index.ts` polls with backoff after save/remove actions so the bridge data is synchronized before the side panel refreshes.
- **Analytics service**: `entrypoints/background/metricService.ts` reports heartbeat and dashboard events with throttling and depends on `@slax-reader/contracts`.
- **Message protocol**: `config/message.ts` defines actions such as `RecordBookmark`, `QueryBookmarkChange`, `BookmarkStatusRefresh` and `TrackDashboardMetric`, together with `BookmarkActionType` and `BookmarkLookupResult` used by the bridge.

## Project structure

```
.
├── src/
│   ├── app.config.ts             # WXT app configuration (analytics)
│   ├── components/
│   │   ├── SidePanel.vue          # side panel (including bridge bookmark state)
│   │   ├── SubscribeCard.vue      # subscription card
│   │   ├── SubscribePlaceholder.vue # subscription placeholder
│   │   ├── AIOverview.vue / AISummaries.vue  # AI outline and summary panels
│   │   ├── Collect.vue             # save dialog
│   │   ├── Chat/                  # chatbot UI
│   │   ├── Markdown/              # Markdown and mind-map rendering
│   │   ├── Modal/                 # about, feedback and sharing dialogs
│   │   ├── Selection/             # highlighting UI and adapters
│   │   ├── Tips/                  # side panel tips
│   │   └── Toast/                 # toast messages
│   ├── bridge/                   # local-first bookmark bridge adapters
│   │   ├── request.ts             # bookmark_id → bookmark_uid placeholder replacement
│   │   └── selectionAdapters.ts   # bridge data source for highlighting
│   ├── config/
│   │   ├── message.ts            # background ↔ content ↔ offscreen actions
│   │   └── panel.ts              # side panel item configuration
│   ├── entrypoints/
│   │   ├── background/
│   │   │   ├── index.ts          # background orchestration and service assembly
│   │   │   ├── authService.ts    # login and session queries
│   │   │   ├── browserService.ts # tab notifications, readiness and context menus
│   │   │   ├── bridgeService.ts  # offscreen document and iframe management
│   │   │   ├── messageHandler.ts # message routing fallback
│   │   │   ├── metricService.ts  # heartbeat and dashboard analytics
│   │   │   ├── sessionService.ts # session state
│   │   │   └── storageService.ts # local storage
│   │   ├── offscreen/             # hidden iframe for Web /x/ext-bridge
│   │   ├── content/index.ts      # SidePanel and Collect injection
│   │   └── mark.content.css      # injected highlight styles
│   ├── assets/                   # icons and images
│   ├── locales/                  # en.json and zh_CN.json
│   ├── styles/reset.scss         # style reset
│   └── utils/                    # request, locale, URL, website, analytics, session and status helpers
├── vendor-shims/                 # dev shims for markmap, highlight.js and katex
├── vendor.config.ts              # vendor bundling configuration
├── scripts/build-vendor.script.ts # vendor prebuild script
├── plugins/                      # build plugins
├── package.json
├── tsconfig.json
└── wxt.config.ts                 # WXT configuration
```

Commands and configuration are in the [local development guide](development.md). Source lives in `apps/extension`; shared frontend libraries live in `packages`.
