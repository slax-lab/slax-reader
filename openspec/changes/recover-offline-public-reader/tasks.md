## 1. Implement the reviewed behavior

- [x] 1.1 Store a public-only sanitized reading representation and a minimal offline renderer with its required assets.
- [x] 1.2 Never persist raw authenticated SSR, private notes or a signed-in owner's private body into this public cache. Use existing anonymous/public access as the admission check. Prefer current content online. Evict the local copy when online access is explicitly denied or revoked. Offline users can read their previously obtained copy until the browser learns of revocation. Text is required through its final paragraph. Linked media and interactive controls may require connectivity.

## 2. Verify the user journey

- [x] 2.1 Exercise **Offline full-text reopen**. When a reader reaches the end of a public HTML article online and later reopens exactly that URL offline in the same browser storage, verify that the title and full readable text through the last paragraph appear with an offline indication and a way to retry.
- [x] 2.2 Exercise **Private or unavailable content**. When a reader navigates offline to an unvisited URL or an article previously accessible only as its owner, verify that an unavailable message appears and no private body, session information or account annotations are exposed.
- [x] 2.3 Exercise **Freshness and revocation**. When the browser reconnects and opens a previously cached URL that has changed or is explicitly no longer public, verify that a successful live read refreshes the saved text and a definitive denial removes the obsolete copy so the next offline visit cannot display it.
- [x] 2.4 Add focused regression coverage for the branches above and run the affected suite. Record running-environment evidence in `validation.md`.
- [x] 2.5 Obtain hands-on acceptance of the changed Web surface before opening the task PR. Run `openspec validate --all --strict` and the repository pre-push review.

- [x] 2.6 On a phone browser and an App-hosted Web browser, visit an eligible article online, go fully offline, reopen the same URL and compare its first and last paragraphs with the online text. Repeat after clearing browser storage and after an online revocation.
