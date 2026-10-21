# Tasks

- [x] Add a pure embedded-browser classifier with explicit app/WebView markers and negative cases for ordinary browsers.
- [x] Add unit tests covering WeChat, Instagram, Facebook-family, YouTube marker, Android WebView, Slax Reader, ordinary external browsers, and unknown user agents.
- [x] Add localized Chinese and English guidance copy and close-label strings.
- [x] Build the client-only `InAppBrowserTip` component with route exclusions, standalone/native-app exclusions, localStorage dismissal state, accessibility, safe-area positioning, and theme tokens.
- [x] Mount the component in the global default layout without changing document flow; preserve existing protocol/document and technical route behavior.
- [x] Add component tests for visibility, close behavior, session persistence, route exclusions, and accessible markup.
- [x] Replace session dismissal with versioned localStorage close counting and one-hour cooldown behavior.
- [x] Add pointer drag dismissal with upward threshold, rebound, pointer cancellation cleanup, and reduced-motion handling.
- [x] Refine the card visual hierarchy with semantic theme tokens, icon badge, drag affordance, safe-area sizing, and localized title copy.
- [x] Add tests for localStorage state validation, first/second manual close behavior, cooldown expiry, drag dismissal, rebound, and external-browser false positives.
- [x] Run targeted Web tests, typecheck, lint, and `openspec validate --all --strict`; inspect the final diff and perform the repository review pass before handoff.
