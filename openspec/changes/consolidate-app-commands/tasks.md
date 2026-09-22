# Tasks

## 1. Dispatcher implementation

- [x] 1.1 Add the shared Node.js app dispatcher and verify it parses the `--` separator, resolves aliases, discovers app scripts, and rejects unknown commands.
- [x] 1.2 Add the root `web` and `extension` wrappers and verify they target the correct workspace package.
- [x] 1.3 Replace the duplicated frontend root scripts with the two dispatcher entries and verify the removed aliases are absent from `package.json`.

## 2. Documentation and migration record

- [x] 2.1 Update root, app, and migration documentation to use `pnpm web -- <command>` and `pnpm extension -- <command>`; verify no removed root alias remains in those documents.
- [x] 2.2 Record the dispatcher convention and future backend boundary in the OpenSpec proposal and design artifacts.

## 3. Validation

- [x] 3.1 Run dispatcher unit tests and JavaScript syntax checks.
- [x] 3.2 Run strict OpenSpec validation and `git diff --check`.
