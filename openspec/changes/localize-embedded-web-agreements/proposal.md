# Open the Terms and Privacy documents in the App's active language

**Approved on November 25, 2026.** The change requester approved the proposed scope and behavior.

## Why

The report saw English agreement bodies in the Chinese iOS login flow. The App opens bare /terms and /privacy URLs; Web already publishes both documents in English and Chinese.

## What Changes

- Pass the active App display language on the existing agreement WebView entry and render both the page title and document body in that language.
- When the App language is English but the WebView has a previous Chinese preference, each linked agreement renders the English document and the active Web preference remains unchanged.

## Capabilities

### New Capabilities

- `embedded-web-agreement-language` — Open the Terms and Privacy documents in the App's active language.

### Modified Capabilities

None.

## Impact

apps/mobile/src/screens/LoginScreen.tsx and apps/web/app/pages/(open_docs)/terms.vue and privacy.vue.

The WebView URL handoff is the only native integration in this proposal. Exercise it on the iOS App before acceptance.

[LoginScreen.tsx](../../../apps/mobile/src/screens/LoginScreen.tsx) · [terms.md](../../../apps/web/open_docs/zh/terms.md) · [privacy.md](../../../apps/web/open_docs/zh/privacy.md)
