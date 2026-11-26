## 1. Implement the reviewed behavior

- [x] 1.1 Add a supported, page-scoped locale hint to the two agreement URLs.
- [x] 1.2 Select the matching existing Web content collection on the initial render. Ordinary visits can keep using the normal Web locale. This change reuses the published texts and does not change global account preferences.

## 2. Verify the user journey

- [x] 2.1 Exercise **Chinese agreement tabs**. When a reader in Chinese App login opens Terms and then Privacy with a fresh embedded browser session, verify that both titles and substantive text, including the first and last section, use the Chinese documents.
- [x] 2.2 Exercise **English App in a Chinese browser**. When the App language is English but the WebView has a previous Chinese preference, verify that each linked agreement renders the English document and the active Web preference remains unchanged.
- [x] 2.3 Exercise **Ordinary Web visit**. When a standalone visitor opens an agreement without a supported locale hint, verify that the public document follows existing Web language selection.
- [x] 2.4 Add focused regression coverage for the branches above and run the affected suite. Record running-environment evidence in `validation.md`.
- [x] 2.5 Obtain hands-on acceptance on the changed Web surface before opening the task PR, including the App WebView on iOS. Run `openspec validate --all --strict` and the repository pre-push review.

- [x] 2.6 Follow the repository Mobile versioning checkpoint for the WebView caller change before implementation handoff, commit or push.
