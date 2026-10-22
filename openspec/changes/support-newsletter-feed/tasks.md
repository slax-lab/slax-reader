# Implementation tasks

## 1. Preparation

- [x] 1.1 Create isolated feat/support-newsletter-feed worktree and reconcile accepted dev defaults and routing evidence; verify branch/base and OpenSpec artifacts.

## 2. API and storage

- [x] 2.1 Add permanent address registry, account availability correction and deletion retirement; verify embedded PostgreSQL tests and actual Worker account/address requests.
- [x] 2.2 Add kind migration, RSS compatibility filters, PowerSync separation and additive Feed contracts/APIs; verify authorization/cursor/RSS tests and rule tests.
- [x] 2.3 Add bounded MIME parsing, email Worker handler, durable receipt admission/recovery, safe R2 publication, deduplication and quotas; verify failure/limit tests and actual local email dispatch through Edge/Core/R2.

## 3. Web

- [x] 3.1 Implement always-visible Feed, account/address setup and per-kind local/REST lifecycles; verify component/data tests and clean full Web suite.
- [x] 3.2 Exercise light/dark/eink at 1440/768/390px, keyboard/reduced motion and recorded states; fix issues and record browser results with zero page errors.

## 4. Integration and review

- [x] 4.1 Generate models/router/DI/types; verify API/contracts/Web typechecks, Edge/Web builds, scoped API lint and strict OpenSpec validation.
- [x] 4.2 Exercise actual local Workers, PostgreSQL/Prisma and R2 plus Web UI; record outcomes, skipped checks and live deployment gaps in validation.md.
- [x] 4.3 Review Bugs/Security/Compliance, fix Important findings and obtain human hands-on acceptance before PR; verify independent review and acceptance record.
- [x] 4.4 Deliver the dev console/release and human test guide; verify explicit routing preserves Catch-all Drop and activation remains off by default.

## Deferred operational acceptance

Remote dev deployment, hosted PowerSync publication and real SMTP acceptance are operator work described in docs/api/NEWSLETTER-DEV-PILOT.md, not claims of this local implementation. Do not activate beta/main until the documented compatibility rollout is complete.
