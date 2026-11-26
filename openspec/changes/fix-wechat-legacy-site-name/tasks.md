# Tasks

## 1. Legacy capture attribution

- [x] 1.1 Add a regression case through the legacy WeChat capture entry point. Verify a missing site name defaults to `微信` in the persisted metadata and capture result and an extracted nonblank name is preserved.
- [x] 1.2 Apply the default before publishing the legacy capture result and run the focused API capture tests, typecheck, and lint.

## 2. Public Collection attribution

- [x] 2.1 Return the saved host with public Collection items and update the response types. Verify the API returns both source fields.
- [x] 2.2 Render the site name or saved host in the existing source label. Verify name precedence, host fallback, and absence of the label when both values are empty with the Collection card tests.

## 3. Running verification

- [x] 3.1 Exercise a legacy WeChat capture with controlled provider responses in a running environment and verify the stored site name and public Collection readback. Verify a pre-existing bookmark with a blank site name displays its host at narrow and wide widths. Record the evidence and any declared gaps in `validation.md`.
- [x] 3.2 Run the focused API and Web checks and `openspec validate --all --strict`. Record the results in `validation.md`.
- [x] 3.3 Prepare the running Web acceptance surface and record human hands-on acceptance in `validation.md` before opening a pull request.
