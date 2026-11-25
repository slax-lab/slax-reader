## 1. Implement the reviewed behavior

- [x] 1.1 Carry the source and a bounded continuation through the initiated auth flow.
- [x] 1.2 Resolve the action once the authenticated identity is known, using the existing Fork admission and idempotency. Complete at the auth handoff before depending on an already-open source page. Distinguish abandonment from provider round trips. A URL or analytics attribution alone cannot authorize a save.

## 2. Verify the user journey

- [x] 2.1 Exercise **Anonymous reader returns from login**. When a visitor clicks Save once on a public snapshot and completes that sign-in, verify that the same source is restored, saving continues automatically and exactly one readable copy appears in the new reader's Inbox even if the source tab is closed after sign-in.
- [x] 2.2 Exercise **Login cancelled or unrelated**. When a visitor cancels sign-in, opens a plain return URL or later signs in independently, verify that no article is saved on that account.
- [x] 2.3 Exercise **Admission fails or repeats**. When the source becomes inaccessible, the request fails, or the successful callback is replayed, verify that failure offers a retry subject to current access and a repeated success produces only one copy.
- [x] 2.4 Add focused regression coverage for the branches above and run the affected suite. Record running-environment evidence in `validation.md`.
- [x] 2.5 Obtain hands-on acceptance of the changed Web surface before opening the task PR. Run `openspec validate --all --strict` and the repository pre-push review.
