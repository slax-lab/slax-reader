## 1. Implement the reviewed behavior

- [x] 1.1 Store the email, challenge ID and absolute expiry/resend deadlines in a separate session-scoped entry keyed to the login purpose and continuation.
- [x] 1.2 Do not store the code or token. Reuse the active host's redirect and attribution. Invalidate on change of address, successful authentication or expiry. Binding and last-successful-email prefill have different purposes.

## 2. Verify the user journey

- [x] 2.1 Exercise **Refresh while collecting mail**. When the reader refreshes the login page or reopens the same login modal before the challenge expires, verify that the original address and code step return with the remaining countdown and without resending mail.
- [x] 2.2 Exercise **Expiry or change of address**. When the challenge has expired or the reader explicitly changes the address, verify that the stale challenge cannot be submitted and the reader can request a fresh code.
- [x] 2.3 Exercise **Successful departure**. When verification succeeds and the original surface reloads, verify that the challenge is cleared and the successful verification cannot be replayed.
- [x] 2.4 Add focused regression coverage for the branches above and run the affected suite. Record running-environment evidence in `validation.md`.
- [x] 2.5 Obtain hands-on acceptance of the changed Web surface before opening the task PR. Run `openspec validate --all --strict` and the repository pre-push review.
