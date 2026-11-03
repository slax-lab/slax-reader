# Validation

## Scope and approval

- Change: `fork-ai-content`; branch: `fix/fork-ai-content`, created from `origin/dev` in its own managed worktree.
- The requesting owner approved the proposal on 2026-11-03 and explicitly required coverage for new Forks and existing affected copies.
- Product changes are API-only saved-text extraction and recovery. No frontend presentation, API shape, schema, dependency, or CLI/Extension/Mobile build output changes. Under `docs/release/VERSIONING.md`, no application package-version decision is required for this API-only change.
- The production bookmark and supplied bearer token have not been used. No production configuration or secret files were read/copied.

## Regression evidence

- Baseline snapshot-bundle suite: 4 tests passed before implementation.
- Red: new div/main/sibling/metadata fragment copy cases failed because the saved AI text was empty (4 failures). After Prisma generation, existing-empty-copy recovery and propagation of HTML storage failure also failed (2 failures); the other 6 read-boundary checks passed.
- Green: `pnpm api -- test test/utils/snapshotBundle.test.ts test/domain/bookmarkSnapshotText.test.ts test/domain/bookmarkFork.test.ts test/flow/bookmarkUid/1-bookmarkIdResolve.test.ts`: 79 tests passed.
- Read-boundary coverage verifies recovery from the destination alone without changing stored objects, exact preservation of nonempty text, unchanged PDF/legacy empty reads, unchanged missing-text behavior, empty/missing HTML outcomes, and propagation of storage errors.
- The composed HTTP exercise exposed another instance of the same defect: historical metadata publication serialized a synthetic body inside a div. Two real-writer regressions caught it. Independent review then caught the equivalent structure in bodyless html-root documents; two additional real-writer cases failed before removing body selection entirely. The final extractor/read-boundary suite passed 22 tests independently.
- Investigated [LinkeDOM's implementation](https://github.com/WebReflection/linkedom/blob/main/esm/html/document.js) and the installed package: body access creates missing head/body children on the document element. Considered reading document children after removing head/script/style content (chosen), wrapping fragments in a normalized document, extracting through a template fragment, and changing the writer to avoid synthetic nodes. Normalization adds parsing, template extraction needs separate full-document handling, and writer changes alone cannot repair existing objects. Selecting even `html > body` was rejected after the bodyless-document publisher regression showed that synthetic body can mask sibling text there too.

## Automated verification

- Final `pnpm api -- test`: 200 files passed, 14 skipped; 2763 tests passed, 113 skipped, no failures. Skipped tests require opt-in runtime resources; they are not counted as passed.
- Final `pnpm api -- typecheck`: passed after the historical-marker correction and runtime fixture additions.
- `pnpm api -- lint`: passed with 0 errors and 344 existing warnings.
- Final `pnpm api -- build`: all four Worker dry-run bundles passed after the historical-marker correction, using the public `deploy/cloudflare/api.toml.example` template.
- `pnpm api -- gen:all`: passed after implementation using the public template, `SLAX_API_SKIP_DOTENV=1`, disabled dotenv loading in Wrangler, and dummy loopback Prisma URLs. No generated tracked diff remained.
- `git diff --check`: passed.

## Running environment

Final command: `PATH="/tmp/fork-ai-docker-bin:$PATH" FORK_SMOKE=1 pnpm api -- test:http`. Passed with exit 0 and `HTTP acceptance: passed`, using disposable PostgreSQL, historical D1 migrations, local KV/R2 and actual Edge/Core HTTP handlers. All owned containers and Worker processes were cleaned up by the harness. Text evidence is retained in this document; local detailed logs are `/tmp/fork-ai-runtime.log` and `.tmp-root-tooling-http-AToSt7/http-results.json`.

- New HTML Fork: a div-rooted source and deliberately stale separate source text were copied through add_url and the real Crawl Workflow. The destination's stored text matched its HTML. Outline, overview, and chat all returned generated content.
- Existing broken copy: emptied the destination text object, cleared cached outline/overview, removed original source records and storage objects, then requested all three AI features again. All received the saved destination text and returned generated content; the empty text object remained unchanged.
- The deterministic transport asserts that the actual Google SDK request includes the destination article text and excludes stale source text. Actual AI services generate/parse responses; chat SSE deltas are joined and the DONE sentinel is required. Test aliases route through Edge authentication to the real Core handlers because the isolated launcher supports only Edge-to-Core; production AiEntry delegates to those same Core handlers. Production Edge-to-AIGC service deployment itself is not exercised.
- Broader exercise passed HTML/shortcut/uploaded-PDF/URL-PDF/YouTube/podcast copying, repeat refresh, finite Workflow failure/retry, attribution revocation, independent content after source deletion, PDF ranges, media variants, recapture, moderation, storage failure guards, normal CRUD, and diagnostic-account cleanup.
- Fixture repairs: the launcher isolates HOME, so a temporary PATH wrapper selects the existing OrbStack Docker socket; the test Worker now accepts the exact `content.internal` host already used by local ContentEntry RPC, which still runs Core authorization. The synthetic chat subscription is removed before later account-deletion checks. No production configuration or runtime tooling was changed.

Earlier exercise failures were resolved: a chat assertion initially searched raw SSE instead of joining deltas; a test-only hostname check rejected ContentEntry RPC; real publication-marker shapes exposed the extraction issues documented above; and the synthetic subscription initially prevented the later account-deletion smoke. The final full exercise passed after those corrections.

## Review and remaining limits

### Owner local acceptance — 2026-11-03

The requesting owner supplied a local test screenshot captured at 17:56:49 (Asia/Shanghai), 2112 × 1526 pixels, light theme. It shows the Fork attribution, the saved article body, a populated overview with takeaways, and a populated outline. No further adjustment was requested with that screenshot. Chat is not visible in the capture; its evidence remains the automated HTTP exercise. The screenshot is attached to PR #490, not committed to Git.

### Initial remote check failure

For commit `fae50a98`, API CI and all application gates passed. The automatic PR review failed after repeated provider errors ending in `503 Service is too busy`; no completed review verdict was produced. The subsequent detection conclusion also failed with `threat-detect binary not found` while detection was skipped after that agent failure. This is recorded as review infrastructure failure, not a passing review or a code-test failure; the review gate must be satisfied by a fresh completed run.

The next review on `8789cd00` ran the three passes and published two nonblocking Nits, but its process became idle after writing inline comments. The harness terminated it after its 120-second post-result watchdog; the required structured verdict was absent and the gate correctly failed closed. The key-layout Nit was addressed by using `snapshotKeys` for the destination HTML key. The chat-parser Nit was rejected against `AigcService.writeChunk`, which emits `choices[0].delta` as an array: flattening is required. A contract comment was added to the fixture. No workflow, timeout, model or gate rule was weakened.

The follow-up passed API typecheck, required generation (no generated tracked diff), lint (0 errors, 344 existing warnings), and the full API suite (2762 passed, 114 skipped). The additional skip is `dev port guard exits before touching shared state when any dev port is occupied`: the owner's active local dev session occupies those ports. The original product behavior is unchanged by the key-helper cleanup. Local Bugs/Security/Compliance review of this follow-up found no Important issues; both remote Nit threads have a concrete fix or a source-backed answer.

Independent Bugs/Security/Compliance review selected `fork-ai-content`. The reviewer identified one Important finding for historically published bodyless html-root documents; it was reproduced with failing tests, fixed by removing body selection, and explicitly closed on re-review. Final review reported no Important findings or Nits and independently passed the 22 focused regressions. `openspec validate --all --strict` passed all 97 items.

At the owner's explicit pre-PR review request on 2026-11-03, a fresh independent reviewer repeated all three passes against the final working tree, read the callers and runtime fixtures, and found no Important findings or Nits. They independently passed 22 focused tests plus probes for plain text, DOCTYPE/comments, trailing fragment text, content following an empty body, and article priority. The full API suite was rerun before PR delivery: 2763 passed, 113 skipped; final strict OpenSpec validation and diff whitespace checks passed. Product code was unchanged during this review round.

Production deployment and live Google provider calls are outside this local task; deterministic transport establishes article input delivery and stream/persistence behavior, not provider availability or answer quality. Archive remains a post-merge docs-PR action.

## Delivery status

Implementation and local verification are complete in the requested worktree. The owner authorized commit, push and a task PR targeting `dev` after the fresh pre-PR review. No remote deployment or archive is part of this delivery. The only unchecked task is 3.5, classified as intentionally deferred until the task PR merges, when a separate human-reviewed docs PR can archive the change.
