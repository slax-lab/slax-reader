## 1. Port and regression coverage

- [x] 1.1 Port the legacy tests and demonstrate failure before the fix.
- [x] 1.2 Port browser-host selection and placeholder rejection into the monorepo API.
- [x] 1.3 Verify provider fallback, full URL preservation, and ordinary article acceptance.

## 2. Verification and delivery

- [x] 2.1 Regenerate backend artifacts and inspect generated changes.
- [x] 2.2 Run API tests, lint, typecheck, formatting, and strict OpenSpec validation; record limitations.
- [x] 2.3 Complete Bugs, Security, and Compliance review and resolve Important findings.

## Verification notes

- Focused regression tests: 7 failures before the port; 36 passing after it.
- `pnpm api -- test`: 150 files passed, 9 skipped; 1664 tests passed, 46 skipped.
- `pnpm api -- lint`: exit 0, with 336 warnings in the existing API sources.
- `pnpm api -- typecheck`: passed.
- `pnpm api -- gen:all`: passed using dummy local PostgreSQL URLs and the tracked public API TOML template; no generated diff.
- `pnpm exec openspec validate --all --strict`: 18 items passed.
- Independent pre-push review completed all three passes: no Important findings or Nits.
- Provider HTTP responses are mocked in regression tests. No live provider request, deployment, or cached-bookmark repair was performed.
