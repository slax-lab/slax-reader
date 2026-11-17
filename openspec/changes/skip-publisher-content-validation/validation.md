## Local Worker exercise

On 2026-11-17 a loopback Miniflare HTTP worker invoked the production `CrawlWorkflow.run` from this branch. The harness supplied a completed fetch step with a stored article body and a publication revision. Local adapters recorded moderation, quality workflow creation, and content post-processing.

| Saving user | Publisher list | Moderation calls | Quality jobs | Post-processing calls |
| --- | --- | ---: | ---: | ---: |
| 7 | `9, 7 ,11` | 1 | 0 | 1 |
| 17 | `9, 7 ,11` | 1 | 1 | 1 |
| 7 | empty | 1 | 1 | 1 |

The exercise covered the dispatch boundary. It used local adapters for storage, the moderation provider and downstream workflow bindings. Hosted Workers, screenshot delivery and live alerts were outside this local exercise.

## Checks

- `pnpm api -- test test/flow/addUrl/10-crawlWorkflowRun.test.ts test/flow/addUrl/7-postCrawlChecks.test.ts test/flow/contentValidationWorkflow.test.ts test/script/layerArchitecture.test.ts` passed all 151 tests.
- `pnpm api -- typecheck` passed.
- ESLint on the changed workflow returned zero errors and three warnings on unchanged lines.
- `openspec validate --all --strict` passed.
