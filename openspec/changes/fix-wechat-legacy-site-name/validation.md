# Validation

## Running verification

On 2026-11-24, a local API fixture ran the real WeChat fetch and capture services with a controlled TikHub HTTP 503 and a successful Zyte HTML response. It exercised both attribution outcomes and read back the metadata written to a temporary file by the snapshot adapter. The article without source metadata was saved with `site_name: "微信"`. The article with a source name retained the extracted value.

The fixture passed its captured and pre-existing bookmark rows through the real Collection service. A running Nuxt server used that response through `/api/collection/source-review` and rendered the actual public Collection route. The browser verified these four rows.

| Bookmark | Public source label |
| --- | --- |
| Fresh legacy capture with no site name | 微信 |
| Historical capture with empty site name and saved host | mp.weixin.qq.com |
| Bookmark with a site name and a different host | 示例出版社 |
| Bookmark with both source fields empty | Omitted |

The four labels were verified at 1280 px in light, dark, and e-ink, and at 768 px and 390 px in light. The narrow and wide views used the same existing card source styling. The before image replays the previous response payload without `host_url` and with the old empty legacy capture name. The after image uses the updated Collection response with the same fixtures.

The targeted run replaced external provider responses and the snapshot persistence adapter with local fixtures. The standard `pnpm api -- test:http` smoke passed with local Workers, PostgreSQL, and R2 after setting local file watchers to polling. The optional extended smoke `FORK_SMOKE=1 pnpm api -- test:http` ran against the same class of disposable resources. After switching the file watcher to polling to avoid `EMFILE`, it reached the media recovery checks and failed in `forkSmoke.ts:654`. The injected supplemental R2 write failure left the fixture status as `failed` where the assertion expected `success`. That run did not complete the Fork smoke. No production provider or database was used for the targeted exercise.

## Automated checks

- `pnpm api -- test test/flow/addUrl/6-parseAndSave.test.ts test/domain/publicAccessSecurity.test.ts test/domain/crawlContent.test.ts test/flow/addUrl/10-crawlWorkflowRun.test.ts test/script/layerArchitecture.test.ts` passed 236 tests in 5 files.
- `pnpm web -- test tests/unit/components/Collection/BookmarkCell.spec.ts tests/unit/components/BookmarkList/BookmarkCell.spec.ts` passed 61 tests in 2 files.
- Full `pnpm web -- test` passed 3,369 tests and skipped 3.
- `pnpm api -- typecheck` and `pnpm web -- typecheck` passed.
- `pnpm api -- lint` completed with zero errors and 335 warnings.
- `pnpm --filter @apps/slax-reader-dweb exec eslint app/components/Collection/BookmarkCell.vue tests/unit/components/Collection/BookmarkCell.spec.ts` passed.
- `pnpm api -- gen:all` completed with the public deployment template and placeholder database URLs.
- `openspec validate --all --strict` passed all 169 items.
- `git diff --check` passed.
- Full `pnpm api -- test` reported 4,511 passing tests and 174 skipped. The newsletter content suite hit a PGlite setup timeout and a Vitest worker reporting timeout. The isolated rerun `pnpm api -- test test/domain/newsletter/content.test.ts --maxWorkers=2 --hookTimeout=30000` passed all 5 tests.

## Human hands-on acceptance

On 2026-11-24, the change requester exercised the running public Collection acceptance page and confirmed that the displayed sources met expectations. No adjustments were requested.
