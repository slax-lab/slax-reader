# Tasks

## 1. Implementation

- [x] 1.1 Map `main` to the `prod` Environment in `.github/workflows/web-deploy.yml`, leaving `TARGET_BRANCH` and the concurrency group on the branch name.
- [x] 1.2 Update `tooling/web-pages-workflow.test.mjs` and `docs/web/deployment.md` to name `prod` for `main`.

## 2. Verification

- [x] 2.1 Run `pnpm test:preflight` and `openspec validate --all --strict`; both must pass.
- [ ] 2.2 Complete the Bugs, Security, and Compliance pre-push review and resolve Important findings.
- [ ] 2.3 After the first merge into `main`, confirm the Web release reads the `prod` Environment and publishes.
