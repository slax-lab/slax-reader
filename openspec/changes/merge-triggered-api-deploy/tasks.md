# Implementation tasks

- [x] 1. Keep one merged-PR deployment workflow: remove the extra merge-entry workflow, release orchestrator/policy/test modules and release:check command; derive dev/beta/prod from the merged target and checkout only its resulting SHA.
- [x] 2. Fetch only the corresponding existing private native TOML at one resolved default-branch commit; require no manifest/ref/path inventory, add no TOML fields, and keep private output suppressed.
- [x] 3. Run existing API generation/build/migration/deployment commands directly in YAML; retain independent test/shared-production locks, stale-release skips, firewall/Tunnel lifecycle, bounded listener startup and always-attempted owned access/file cleanup.
- [x] 4. Keep private agent credential rules and simplify PR Secret checks to direct pinned Gitleaks plus inline credential-file checks, deleting the custom scanner scripts/tests and the release manifest.
- [x] 5. Simplify operator docs around the three files, existing deployment Secrets and one workflow; verify no references require removed scripts or extra configuration.
- [x] 6. Verify YAML/inline code and synthetic event/fetch/failure/privacy/cleanup cases, run existing API deployment regressions and OpenSpec strict validation, complete Bugs/Security/Compliance review and commit the authorized task branches.
- [x] 7. Filter API releases by API-related paths, preserve pending releases across unrelated frontend/documentation merges, reserve independent future Web/Extension path scopes in the guide, and verify the selection and supersession behavior offline.
- [x] 8. Simplify the existing YAML to the legacy release sequence: remove repeated PR quality checks, keep one pre-mutation source check, replace custom database probing with bounded Tunnel startup and existing migration failures, and verify privacy and cleanup without adding maintained scripts.

OpenSpec: merge-triggered-api-deploy. Live deployment and remote migrations are outside implementation verification. Publication depends on GitHub network/write access; do not claim a PR exists until it is created.
