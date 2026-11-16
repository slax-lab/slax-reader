# Tasks

## 1. Approval and Task Isolation

- [x] 1.1 Obtain human review of proposal.md, specs/zhihu-capture/spec.md, and design.md before implementation; verify a subsequent explicit approval to apply this change exists in the conversation.
- [x] 1.2 Prepare `fix/zhihu-partial-capture` from `origin/dev` in an isolated checkout, carry only this change's planning artifacts, and read applicable local instructions; verify the branch base and that unrelated work in the original checkout is unchanged.

## 2. Independent Provider Requests

- [x] 2.1 Extract the Zhihu-specific adapter into `apps/api/src/infra/external/zhihu.ts`, retain the existing SocialMediaApi entry point and return shape, and add the typed no-content error; verify supported URL routing, unsupported URLs, exact large ID strings, and unchanged successful rendering with adapter tests.
- [x] 2.2 Implement endpoint-local four-attempt retry budgets with 1/2/4-second waits and a 20-second fetch/body deadline; verify recovery, exhaustion, malformed responses, timeouts, generic TikHub 400, HTTP 408/5xx, and immediate stop for non-transient or rate-limit responses using mocked fetch and fake timers.
- [x] 2.3 Replace question all-or-nothing fetching with independently settled requests and preserve the existing first-page arguments; verify that a successful endpoint is called once while the other retries, both partial-success directions retain their usable content, and full success preserves provider order and metadata.
- [x] 2.4 Validate assembled body usability before adding title/author markup, filter unusable answer entries and pin blocks, and preserve supported media; verify valid empty lists, metadata-only rejection, whitespace-only markup, short prose, lazy/image-only content, missing optional metadata, and no substitution of unrelated answers.
- [x] 2.5 Add bounded allowlisted diagnostics for omitted/exhausted parts; verify endpoint, attempts, status, and request ID survive while tokens, headers, arbitrary provider messages, raw payloads, and diagnostics in saved HTML do not.

## 3. Workflow Integration

- [x] 3.1 Translate only the typed Zhihu no-content error into a terminal workflow error after step tracking, retaining exhausted-provider alert classification and existing failed-capture/import accounting; verify the workflow test harness observes NonRetryableError, no success publication, no outer provider retry cycle, and unchanged behavior for other errors/platforms.
- [x] 3.2 Extend `apps/api/test/flow/addUrl/10-crawlWorkflowRun.test.ts` to cover partial capture through parsing and post-processing; verify successful parts reach `parseAndSaveZhihu`, generic scraping is not invoked, and the workflow's completed fetch output is reused rather than re-requested for later parse handling.

## 4. Verification and Delivery

- [x] 4.1 Run the focused adapter/workflow tests, the full API test suite, API typecheck, lint, and the documented API build; record commands/results and distinguish any unrelated baseline failures. Verify generated files are updated only through required generators if the implementation touches generated surfaces.
- [x] 4.2 Exercise real local save/read flows for answers-only, description-only, retry recovery, and no-content failure using controlled provider responses; record endpoint call counts, stored body/state, real versus stubbed boundaries, and any execution gaps in `validation.md` according to `docs/DEFINITION-OF-DONE.md`. Live TikHub checks are supplemental and must be deliberate because successful calls are billable.
- [ ] 4.3 Obtain human hands-on acceptance of partial saved content before any PR; record who accepted, the date, and the reviewed scenarios in `validation.md`, without presenting proposal approval as reader acceptance.
- [x] 4.4 Run `pnpm exec openspec validate --all --strict`, review the complete change under `REVIEW.md`, and resolve relevant findings before any requested push/PR; verify the final diff contains only this change and remove only known temporary artifacts created by its checks. Reassess client package version obligations if the actual diff expands beyond API-only scope.

Planning artifacts are documentation-only and do not constitute implementation or runtime verification. No deployment, production replay, push, or PR is authorized by this task list.
