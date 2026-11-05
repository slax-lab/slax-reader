# Validation

## Scope and authorization

The user requested implementation, local frontend and backend startup, a real save of `https://pca.st/8ueht2r9`, and then a clean local rerun through the API to find where generation is slow. The user authorized deleting local history and ignoring local model cost. No remote deployment, remote data change, or remote job retry was performed.

## Incident evidence (dev, before this change)

Cloudflare Workflow history for source `551ced75c7efa5809abc10dd7088c949` on dev: article 18 planned nine editing chunks; `polish-en-chunk-1` ended `chunk_truncated` on every attempt while sibling chunks were reused. The page stayed on "Writing the readable transcript".

## Root cause (measured locally)

Per-call diagnostics (finish reason, output tokens, repetition ratio, and the character classes of the repeating tail, never the text) on the real model showed:

- Runaway calls ended `MAX_TOKENS` with repetition ratio 1.0 and about 1.15 characters per token, versus about 3.6 for healthy replies.
- The repeating tail had period 1 and was 100% digits. Cue-id share and whitespace runs were normal, so the loop was not in `source_cue_ids` or padding.
- The polish request reused the YouTube response schema, which declares integer fields (`schema_version`, section `start_ms`, `end_ms`). The parser treats them as optional and merging recomputes section times from cue ids, so the model output for them is unused. The model looped emitting digits in an integer field.
- Frequency: 8 of 22 calls looped in one clean run. Each loop took 33 to 236 s; healthy calls had an 11 s median. Raising temperature to the documented Gemini 3 default of 1.0 alone did not stop the loops.
- Raising the output ceiling to 65,536 made it worse: one loop ran 236 s and produced 65,521 tokens for a 2,867-token request.

## Fix verified in the running environment

After the podcast polish request switched to a schema without integer fields, with an input-proportional output limit:

- Clean run from an API `add_url` call (local history and caches deleted first): `add_url` returned 200 in 188 ms; crawl and podcast trigger about 13 s; AssemblyAI transcription of the 86-minute episode about 41 s.
- Polish: 13 calls, 0 runaway, maximum 19 s, median 11 s. Translation to Chinese: 8 calls, median 25 s. Original and translation both `ready` 132 s after the transcript.
- The first complete run then failed the quality gate on `duplicate_paragraph`. Diagnostics showed a single 4-character paragraph repeated at distant cues `c0057` and `c0243`, a speaker's backchannel. Podcast quality now ignores short repeats unless the copies share a cue; YouTube keeps the exact-repeat rule.
- Browser check of bookmark `88b05aef-0fc3-4bf7-8fe1-4f99a110a352`: 282 paragraphs, 29 topic headings with contents entries and chapter buttons, a 504-character introduction, original and translation toggle. Section times run from 0:00 to 1:24:34.

## Chunk stability, 2026-11-03

Changes: all chunks run at once (ten workers, cost admission unchanged); overlap cue ids are removed from mixed paragraphs; each generated part passes the article checks on its own cues before it is cached, so a bad reply is asked again alone; an assemble-time failure redoes only the affected chunks once; Chinese "万/亿" amounts count toward number coverage.

Before the magnitude rule, a passing translation sat exactly on the 0.85 number threshold: the three missing numbers were "50,000" and "80,000", written correctly as "5 万" and "8 万", and "00" from a time. With the rule the same article scores 0.95.

Four consecutive clean runs of this episode, each created through `add_url` after deleting the local bookmark, episode, articles and caches:

| Run | Original ready | Translation ready | en numbers | zh numbers | Sections |
| --- | --- | --- | --- | --- | --- |
| 1 | 79 s | 113 s | 1.0 | 0.85 (0.95 with the 万/亿 rule, added after this run) | 30 |
| 2 | 126 s | 160 s | 1.0 | 0.95 | 32 |
| 3 | 81 s | 116 s | 0.947 | 0.947 | 33 |
| 4 | 109 s | 184 s | 1.0 | 0.95 | 31 |

Times are from the save. Transcription took 37 to 72 s of each; the rest varies with provider latency.

- 89 model calls, all ended `STOP`: polish 54 (median 12 s, p90 19 s, max 24 s), translation 35 (median 19 s, p90 25 s, max 29 s).
- No truncated reply, timeout, rejected part, or repair pass.
- Browser check of the last run: 274 paragraphs, 31 headings with chapter buttons, a 536-character introduction, original and translation toggle, and no backward step in paragraph start times.
- Cost per run: original about $0.14, translation $0.09 to $0.11.
- Local testing exhausted the five new episodes per user per day; the shared limit counter was left untouched and the limit was raised in local code for the runs, then restored.

## Local environment notes

- The copied local TOML lacked the `PODCAST_WORKFLOW` binding; it was added to the ignored local `env.dev` configuration only.
- The local AssemblyAI key was provisioned privately by the operator.
- Hot reload interrupts in-flight local Workflow steps, which then stay "Working"; affected runs were restarted from the article claim step. This is a local development limitation.
- After manual row resets, the owner retry endpoint settled the ready article without model calls.

## Not verified

- The earlier 93 s backward step in paragraph start times came from overlap cues kept in a mixed paragraph; after removing them, four runs showed no backward step.
- Behavior on dev or beta after deployment.
- Episodes other than this one.

## Automated checks

Run after the final test update, with the temporary local cost limit and diagnostics removed:

- `pnpm api -- test`: 2,807 passed, 113 skipped (199 passed, 14 skipped files).
- `pnpm api -- typecheck`, `pnpm api -- lint` (0 errors, 344 existing warnings) and `pnpm api -- build`: passed.
- `pnpm exec openspec validate --all --strict`: 97 passed, 0 failed. `git diff --check`: passed.


## Pre-PR follow-up, 2026-11-04

### Human acceptance and requested delivery

Daguang confirmed in the current review chat on 2026-11-04 that hands-on acceptance had passed and requested another performance run followed by a PR to dev if performance is satisfactory. No additional presentation adjustment was requested. The review corrections below enforce the existing ordered-transcript and local-retry requirements. The resumed clean provider run below verifies these corrections before the PR.

### Review corrections

- Added opt-in paragraph-order validation to the shared checker and enabled it for podcasts. It rejects backward paragraph start cues within a section and across sections, while permitting distinct paragraphs that share a start cue. YouTube defaults retain their previous behavior.
- Check the actual introduction before caching the first polish part. Empty introductions retry only that part. Legacy whole-chunk caches with an empty introduction target chunk zero during the existing repair pass.
- Changed the concurrency delta to modify the preceding "Concurrent readable podcast articles" requirement. The prior merged podcast deltas must be archived first so this modification replaces their five-call bound.
- Added a post-merge archive task in accordance with the explicit instructions supplied in the review chat. It remains pending until the task PR merges.

### Earlier restricted-environment attempt (superseded below)

- Focused runner, podcast utilities and shared YouTube utilities: 166 passed across three test files, using `vitest run --configLoader runner --no-cache`. Includes within-section reversal, equal starts, first-part introduction retries and legacy-cache targeted repair.
- Contracts and API TypeScript checks: passed via the installed `tsc` binaries with each project's tsconfig.
- API lint: passed with zero errors and 344 existing warnings.
- API build: all four Workers passed the repository's `script/deploy/build.ts` dry-run build, invoked through `pnpm --filter slax-reader-backend exec node -r tsx/cjs` to avoid the tsx CLI's disallowed IPC socket.
- OpenSpec strict validation: 97 passed, zero failed. `git diff --check` passed.
- Full API suite was attempted: 2,761 passed, 44 failed, 117 skipped, with two unhandled local-listener errors. The seven failing files were `imageProxy`, `publicFetch`, `devPortGuard`, `envFiles`, `generatorPaths`, `rootDeployment` and `setupApi`. Failures occurred in local TCP/IPC setup (`listen EPERM`) and package-manager subprocess startup/timeouts. This run is not recorded as a passing full suite.
- The installed pnpm was 11.2.2, while the repository requests 11.25.0. Automatic version download could not reach the network. Offline wrapper commands used `pnpm_config_pm_on_fail=ignore`; no dependency or manifest was changed. The pinned-version checks still need rerunning in the normal development environment.
- `pnpm api -- gen:all` generated Prisma clients, then failed because the tsx CLI could not create its IPC socket. The existing cron, consumer, router and DI generators were also run directly through the TypeScript loader and produced no tracked drift. Worker runtime type generation independently failed on `listen EPERM 127.0.0.1`. No generated source was edited by hand.

### Earlier runtime blocker (resolved)

The command environment denied access to the Docker socket, local TCP connections and listener creation even after requesting elevated execution. Starting the API failed with `listen EPERM` on the tsx IPC socket. GitHub DNS resolution also failed from the shell, although the GitHub connector could read dev at `090443e6c6d95219dc09c14a3c49bc9c60c2e0ee`.

No new paid provider run or performance measurement was completed. The historical four-run timings above are not measurements of this revision. The requested performance-before-PR condition remains open. Resume by restoring local service/network access, rerunning failed checks with the pinned toolchain, and exercising real generation with fresh article caches before submitting the task PR.

### Local pre-push review

- Bugs: reproduced paragraph-order and empty-introduction defects are covered and corrected. Existing successful chunk reuse, bounded retries, ordered assembly and cost admission were inspected. No further Important finding was identified in the current diff. The earlier full-suite and real-runtime blockers were resolved in the resumed verification below.
- Security: reviewed the changed model requests, prompts, output parsing, count-only diagnostics and cache/accounting paths. No new dependency, credential exposure, endpoint or external data destination was introduced.
- Compliance: change ID is `recover-podcast-truncation`. The proposal, design and delta now cover the corrections, preserve YouTube defaults and record the human acceptance. Real performance confirmation is recorded below; archival is deferred until after merge.
- Scope clarification: the existing ASR database-cost marker precedes the daily Redis cost update. If the Redis write fails after that marker, a poll retry can skip the daily charge. The fail-closed change here covers model-call admission within an article attempt; it does not claim to remediate that pre-existing ASR cross-store accounting gap. A separate accounting change would need its own design and validation.


### Resumed clean provider verification

After the operator restored normal command permissions, the pinned pnpm 11.25.0 ran successfully. `pnpm api -- gen:all` completed Prisma, Worker type, cron, consumer, router and DI generation with no tracked generated drift. The unrestricted full suite passed (2,809 passed, 113 skipped); typecheck, lint (zero errors, 344 existing warnings), all four Worker builds and strict OpenSpec validation passed. This supersedes the restricted-environment failures above.

On 2026-11-04, saved `https://pca.st/8ueht2r9` through the real local Web add-link dialog after backing up and resetting only this test episode's local rows and R2 objects. No provider responses, generated articles or transcript were mocked; no quota or cost limits were changed. Bookmark `a2bb4396-c996-4183-be7d-4f95df525535`, episode 10, original article 16, translation 17. The fresh AssemblyAI transcript has 569 cues and hash `b8b667c1e6be39576d6dc27d32088b99b457703df6461b7c4c5a06ed58cc519f`.

| Milestone | UTC timestamp | Seconds from save |
| --- | --- | --- |
| Bookmark saved | 01:39:01.810 | 0 |
| Transcript ready | 01:40:28.216 | 86.406 |
| Original article ready | 01:40:54.580 | 112.770 |
| Chinese translation ready | 01:41:34.194 | 152.384 |

Timings use database creation/completion timestamps, not the monitoring script's earlier start time. Original generation took 26.3 seconds after transcript availability. Translation generation took 29.8 seconds after its article row was created; original publication/snapshot settlement preceded translation startup.

- Fourteen polish calls: median 12.75 seconds, maximum 21.64 seconds. Eight translation calls: median 19.37 seconds, maximum 29.42 seconds. All 22 calls ended `STOP` with outcome `ok`.
- Five proactive request-size splits; zero truncations, timeouts, rejected parts, unknown-usage charges or assembled repair passes. Fresh whole-chunk caches were generated for nine original chunks and eight translation chunks.
- Both quality reports passed: 31 sections, 279 paragraphs, number coverage 0.947 and language ratio 1.0. Original length ratio 0.955; translation length ratio 0.407. Introduction lengths were 542 and 260 characters.
- Independent inspection of the stored articles found zero backward paragraph starts in either language, and identical paragraph cue references across the original and translation. Starts span 240 to 5,122,540 ms.
- Recorded generation cost: original $0.143513, translation $0.0921045; ASR $0.2431. Combined $0.4787175, within the unchanged $1 episode limit.
- Browser smoke: loaded the fresh bookmark, observed readable original and Chinese content with 31 contents entries and chapter controls, and switched original → translation successfully. Daguang's human hands-on acceptance was already recorded above.

The 112.8/152.4-second completion times fall within the preceding four clean runs' 79–126/113–184-second ranges. This supports no observed regression on this episode; it is not a proof that ten workers are globally optimal. No five-versus-ten controlled benchmark, other-episode sample or remote deployment was performed. Truncation, timeout, accounting failures and repair exhaustion were covered by automated regressions rather than forced paid-provider failures.

Local raw evidence: `/tmp/podcast-nov4-live.log`, `/tmp/podcast-nov4-performance.log` and `/tmp/podcast-nov4-results.json`; these are not committed and the measurements needed for review are recorded here.

### Final pre-push review

Bugs, Security and Compliance passes were repeated against the final diff for `recover-podcast-truncation`. No Important findings remain. Two additional regressions exercise untargetable global number-coverage repair and persistent failure: every chunk regenerates once, fresh assembly executes, and persistent failure clears caches without publishing. The task branch was aligned to `origin/dev` at `090443e6` without conflicts; upstream changes do not modify the podcast runner or quality helpers. The live generation above used the same runtime patch before this base update, and the final automated checks exercise the updated base. The branch name is `fix/recover-podcast-truncation`, matching the change ID.

Version decision: this diff changes API internals and tests only. It does not affect CLI, Extension or Mobile logic, contracts, dependencies or build output, so no application version increment is applicable. The only intentionally unchecked task is post-merge archival, deferred until the task PR merges and the preceding podcast deltas are archived in dependency order.

Final checks on the updated base (pnpm 11.25.0):

- `pnpm api -- test`: 2,828 passed, 114 skipped; 200 passed and 14 skipped files. The additional skipped test comes from the upstream snapshot change. Integration tests requiring optional external test configuration remain skipped by the suite.
- `pnpm api -- typecheck`: passed for contracts and API.
- `pnpm api -- lint`: zero errors, 344 existing warnings.
- `pnpm api -- build`: all four Worker dry-run builds passed.
- `pnpm exec openspec validate --all --strict`: 98 passed, zero failed.
- `git diff --check`: passed. No generated artifacts, local configuration or test data enter this diff.
