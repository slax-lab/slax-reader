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
- [x] 4.4 Deliver the original dev console/release and human test guide; its exact-address pilot was superseded by later approved routing revisions.

## 5. Superseded root-domain revision (2026-10-27, never deployed)

- [x] 5.1 Enforce the daguang@slax.app business reservation for provisioning, reads and receipt lookup; verify dev eligibility, stale bindings, case handling and rename stability with regression tests.
- [x] 5.2 Update private deployment configuration to slax.dev for enabled dev and slax.app for disabled beta/production; preserve all other configuration bytes and existing Worker identities.
- [x] 5.3 Replace the exact-address pilot instructions with root-domain Catch-all readiness, console actions, rollback and multi-user test steps; preserve the existing production business forwarding rule.
- [x] 5.4 Run generated-code checks, API tests/typecheck, affected Web tests, actual local Worker exercises and Bugs/Security/Compliance review; record evidence and update the existing draft PRs without adding assignees or reviewers.

## Deferred operational acceptance

Remote dev deployment, hosted RSS compatibility-rule publication and real SMTP acceptance are operator work described in docs/api/NEWSLETTER-DEV-PILOT.md, not claims of this local implementation. Do not activate beta/main until the documented compatibility rollout is complete.

## 6. Approved feed+ subaddress revision (2026-10-27)

- [x] 6.1 Implement prefixed address rendering and strict envelope parsing over stable account-token reservations; verify length, rename, malformed/foreign recipients and daguang namespace separation with regression-first tests.
- [x] 6.2 Update private dev and disabled beta/production domains, preserving unrelated configuration; document subdomain onboarding, Subaddressing, one literal feed route and scoped rollback.
- [x] 6.3 Run generation, API/Web checks and actual local Workers in both selected domains; record evidence, operator gaps and Bugs/Security/Compliance review.
- [x] 6.4 Update both existing draft PRs without adding assignees or reviewers and deliver the revised human test guide.

- [x] 6.5 Synchronize the newly merged local-first-ddl dev changes; preserve anchored queries, kind isolation and legacy projections, verify generated artifacts/full API tests/actual local Workers/PowerSync setup, and re-review before pushing the conflict resolution.

## 7. Approved REST-first Newsletter revision (2026-10-27)

- [x] 7.1 Remove newsletter_v1 and Newsletter client synchronization; retain RSS kind isolation, RSS-only local-first behavior and stale-row guards.
- [x] 7.2 Route unified Feed reads through REST whenever Newsletter is enabled; verify healthy/pending database independence, pagination/cache retention and mode/account/Lab transition fences with regression-first tests.
- [x] 7.3 Verify complete API/Web suites, running REST Feed/Worker behavior, types and strict OpenSpec validation; complete Bugs/Security/Compliance review and update evidence.
- [x] 7.4 Update both existing draft PR descriptions and current operator/test guides; clarify composite email fields and Worker deployment prerequisites, without adding assignees/reviewers.

## 8. Approved review revision (2026-10-27)

Newsletter-specific compatibility in the original 8.2 decision was superseded by the explicit first-release simplification in 8.7. RSS compatibility remains required.

- [x] 8.1 Add generic physical Feed sources with a transactional old-to-new write mirror and explicit backfill; preserve legacy RSS writes and sync client aliases.
- [x] 8.2 Move immutable Newsletter addresses into platform bindings, retain overlap tombstones, and add a BIGINT receipt primary key without destroying legacy processing identities.
- [x] 8.3 Remove deployment boolean admission, consolidate address setup into user settings, and await synchronous publication with pending dedupe and durable cancellation.
- [x] 8.4 Reuse quiet pure content extraction, preserve attachment metadata/existing links, filter explicit tracking pixels and provide offline EML preview/local replay tooling.
- [x] 8.5 Update Web setup calls and repair states, verify actual browser behavior and obtain renewed human hands-on acceptance.
- [x] 8.6 Update private pilot configuration and rollout/test guides, run generation/full checks/local Worker verification and three-pass review, then update the original PRs. Record hosted SMTP and real EML gaps explicitly.

- [x] 8.7 Remove all unshipped Newsletter compatibility, consolidate the first-release migration, and verify platform-only bindings, numeric receipt IDs and current staged-content recovery without resetting operator databases.
- [x] 8.8 Trace RSS Save to Inbox storage and report independent snapshot/reuse behavior; do not add Newsletter saving in this revision.

- [x] 8.9 Record the user's real-EML local acceptance, document local runtime setup/path quoting, and update the original PR with the three authorized test screenshots.

- [x] 8.10 Preconfigure newsletterreader.slax.com in beta/prod/legacy-main while preserving the dev domain and unrelated private configuration bytes; synchronize rollout/spec/PR descriptions and verify TOML syntax/selected values without deployment.

- [x] 8.11 Remove Newsletter background recovery, temporary payloads and retry scheduling/counters; preserve synchronous publication/dedupe/cancellation, edit the unmerged initial DDL directly, verify fresh disposable databases/Workers and update the original PRs without resetting the operator database.

## 9. Archive after merge

- [ ] 9.1 After the task PR merges, classify every remaining unchecked task and archive this OpenSpec change through a separate documentation PR.
