## Verification

The change requester approved the proposal and scenarios on 2026-11-19. Runtime checks used disposable local resources and historical migrations.

### Automated checks

| Command | Result |
| --- | --- |
| `pnpm api -- gen:all` | Passed with the public Worker template and local code-generation placeholders. The generated files matched the tracked versions. |
| `pnpm api -- lint` and `pnpm api -- typecheck` | Passed. |
| `pnpm api -- test` | 271 files passed. 4,339 tests passed and 162 conditional tests were skipped. |
| `pnpm api -- test:http` | Standard HTTP acceptance passed. |
| `pnpm api -- test test/script/layerArchitecture.test.ts` | 35 passed. |
| `pnpm api -- test test/domain/bookmarkFork.test.ts test/domain/labService.test.ts` | 82 passed. Before the fix, the changed Fork suite reproduced `LAB_FEATURE_DISABLED` on admission and copy. |
| `FORK_TEST_DATABASE_URL=<disposable PostgreSQL> pnpm api -- test test/infra/bookmarkFork.integration.test.ts -t 'enables the selected Lab\|keeps the Lab off\|leaves a disabled Lab\|synchronous Reader import'` | Four targeted tests passed after replaying 60 PostgreSQL migrations. |
| `openspec validate --all --strict` | 158 passed. |

### Acceptance scenarios

| Scenario | Observed result |
| --- | --- |
| PDF, podcast, and YouTube with Labs off | `FORK_SMOKE=1 pnpm api -- test:http` exercised authenticated Edge and Core requests, the Crawl Workflow, PostgreSQL, and local R2. Each successful copy turned on its matching switch if it was off and preserved every other switch in `/v1/user/labs`. The YouTube copy retained its already-ready article while leaving `youtube_article` off. A historical YouTube snapshot without a media reference enabled `youtube` through the existing video URL rule. |
| Ordinary article and shortcut | The HTTP smoke compared the full Labs response before and after both saves and an ordinary article refresh with mixed Lab settings. Unit tests also covered an ordinary capture of a podcast provider URL and an HTML article with a `.pdf` URL. |
| Online acknowledgement, pending copy, and failure | The PDF save returned the existing empty `bmId` acknowledgement with its destination processing and `pdf` off. The source object was missing and `pdf` stayed off through the terminal failed status. Supplying the object and explicitly retrying published the PDF at the same destination and enabled `pdf`. |
| Denied or changed source and publication rollback | A denied podcast Fork returned unavailable with the Labs response unchanged. Domain tests rejected stale source identity, revision, or access. In PostgreSQL a stale destination revision aborted publication and rolled back the attempted Lab insert. |
| Synchronous Fork | The integration fixture ran the Reader import entry point with a historical YouTube snapshot and the Lab off. The completed copy and its `youtube` preference were readable in PostgreSQL after the synchronous call returned. |
| Already enabled, opt-out, and repeat | HTTP repeat publication preserved Labs values and activation times. Explicit Settings opt-out followed by a successful podcast refresh re-enabled only `podcast` at the existing destination. The repository test verified that an existing-item response without publication left the Lab off. |
| External acquisition | A direct YouTube URL save and a direct PDF upload returned their existing Labs rejection while the corresponding switches were off. The Labs response stayed the same. |

### Human hands-on acceptance

On 2026-11-19, the change requester accepted both scenarios in the local Web Reader using a disposable test account. They confirmed that Forking the ordinary article preserved all Labs settings and that successfully Forking the podcast enabled only Podcast articles. The implementation exercised in that session was accepted as presented.

### Broader test coverage

- The full PostgreSQL Fork suite reported 43 passes and one failure. The existing account deletion test omits a Vector Workflow binding and raises `missing_vector_maintenance_workflow`. The same failure occurred before the runtime change.
- The full HTTP run with `FORK_SMOKE=1` printed the Fork Labs acceptance marker after completing the scenarios above. Later it stopped at the existing supplemental R2 retry assertion. That assertion expects `success` after a partial write, while the current media publication path records `failed`. The same assertion failed on a clean checkout of baseline `c5d78ee52`. Checks after that assertion did not execute in either Fork-enabled run.

### Local review

- **Bugs**. The online and synchronous paths use the same registry resolution and publication transaction. The existing-item return precedes the Lab write. The PostgreSQL write repeats safely and preserves the timestamp of an already-enabled row.
- **Security**. Source authorization, moderation, and destination claim checks remain in place. The server resolves the Lab key from the existing registry and writes for the authorized destination account with bound SQL parameters.
- **Compliance**. The diff implements `enable-labs-on-fork` inside the existing domain and repository boundaries. The existing transports, Workflow dispatch, and Settings interface retain their roles. The review found no Important issues introduced by this change.
