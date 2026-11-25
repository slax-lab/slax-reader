## 1. Implement the reviewed behavior

- [x] 1.1 Distinguish an expired session from intentional sign-out at the point that owns database reset.
- [x] 1.2 Suspend the existing queue, hide its rows while signed out and compare its existing owner stamp with the authenticated identity before reconnecting. Keep ordinary logout and account-switch cleanup.

## 2. Verify the user journey

- [x] 2.1 Exercise **Expired upload**. When a reader renames a saved article and authentication expires before that write uploads, verify that sign-in recovery explains that an edit awaits synchronization without exposing its contents on the signed-out screen.
- [x] 2.2 Exercise **Same owner returns**. When the same account signs in after the interrupted upload, verify that the new title returns, the pending change uploads, and a second session reads the new title.
- [x] 2.3 Exercise **Different owner returns**. When another account signs in or the original reader explicitly signs out, verify that the previous account's data and queue cannot appear or upload under the new identity.
- [x] 2.4 Add focused regression coverage for the branches above and run the affected suite. Record running-environment evidence in `validation.md`.
- [x] 2.5 Obtain hands-on acceptance of the changed Web surface before opening the task PR. Run `openspec validate --all --strict` and the repository pre-push review.

- [x] 2.6 In a running browser, hold the alias write, return 401 on upload, sign into the same account, and compare the exact title in a second session. Repeat with a different account and verify that the pending edit never appears there.
