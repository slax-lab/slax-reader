# Validation — 2026-10-29

## Scope and source

Branch: `feat/fix-youtube-style`, based on `origin/dev` at `30feba75`. Only edited YouTube Web body presentation changes. The player sizing, sidebar, API, original captions, podcast source, manifests, and dependencies are unchanged. No CLI, Extension, or Mobile package/output is affected, so no packaged-app version decision is required.

The user supplied the desired expanded-article screenshots, rejected an earlier spacing-only preview, then reviewed the revised live-browser preview with chapter times and no paragraph playback indicators. The user explicitly requested this branch, a PR, and cleanup afterward. This authorizes the PR handoff, not merge/deployment. It does not establish hands-on acceptance of the final source implementation; the PR remains draft pending that acceptance.

## Automated checks

| Command/check | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` in the isolated worktree | Passed; no lockfile change |
| Processor regression before implementation | 3 failed, 8 passed; missing chapter controls and old playback indicators reproduced |
| Focused YouTube processor, Podcast processor, and YoutubeAiArticle tests | 41 passed |
| `pnpm web -- typecheck` | Passed |
| `pnpm web -- test` | 224 files passed, 1 skipped; 2,559 tests passed, 3 skipped |
| `pnpm web -- build` | Passed; complete Cloudflare Pages `dist` output generated locally |
| Contracts and selection type checks | Passed |
| `pnpm icons:test` / `pnpm icons:check` | 17 tests passed; 56 registry entries valid |
| Scoped ESLint on changed processor, unit tests, and browser script | Passed |
| `pnpm exec openspec validate --all --strict` | 86 items passed, 0 failed |
| `git diff --check` | Passed |

Typecheck/build used the documented synthetic public development configuration: localhost origins, local placeholder API/cookie/OAuth values. These checks do not establish authentication or backend integration. First dev startup exposed missing generated Nuxt tsconfig; the standard `pnpm web -- setup` generated it and the normal dev command then ran successfully. No secret files were read or copied.

## Browser checks

### Reproducible compiled cascade

Run from `apps/web`:

```sh
node tests/fixtures/media-recovery/20261029-youtube-style-check.mjs --cascade
```

The script compiles the actual global, reader, and expanded-component Sass/UnoCSS/Vue styles and tests both markup paths in Chrome at 375, 768, 769, and 1200px for light, dark, and e-ink: 24 combinations passed. It checks nested paragraph 18px/33.3px typography, 0/20px paragraph margins including the last paragraph, 26px/1.4 headings and 44/20px margins, 14px start-aligned contents, 12px accent chapter controls, visible focus, minimum 44px targets, hidden paragraph times, and no document overflow. Generic article, raw-caption, and podcast negative controls retain identical computed styles. These are constructed markup controls, not live backend evidence.

### Actual reported article in the complete application

Source: anonymous HTTP 200 GETs of the reported dev bookmark `980e2f6b-f36e-4658-9cf6-c5ade249cd30`, article status, and article JSON. Article version: `a7d32852-7f8f-417d-8b91-8844b6380974-en`. The saved body contains 17 sections and 85 paragraphs. Only presentation metadata and public article content were retained for temporary local testing; the internal snapshot script and unrelated identity fields were removed. No remote write or generation request was made.

The actual Nuxt app ran from this worktree on `http://localhost:3217`. Playwright intercepted read requests to replay those public responses; unrelated marks were empty test responses and non-GET API traffic was blocked. This is real-content local rendering, not a deployed `.dev` fix or complete backend integration.

- Saved-body path: 15 combinations passed (375, 768, 769, 1200, 1920px × light/dark/e-ink). All 85 paragraph texts exactly matched canonical article text; all 17 headings expose chapter buttons. Paragraph times are hidden and outside the tab sequence; paragraph background/edge are absent; line height is 33.3px and contents labels are 14px/start-aligned. No heading or document horizontal overflow.
- Expanded path: same real JSON rendered through `YoutubeAiArticle.vue`; the test changed only status body mode and removed the saved derived body to exercise this existing fallback. Twelve combinations passed (375, 768, 769, 1200px × three themes), with the same 17 chapters/85 paragraphs and exact text. Speaker labels were compared separately from paragraph text.
- Enter and Space each emitted one chapter seek, `[66, 66]`, in both paths. Saved contents navigation put the selected heading at about 88px. No uncaught page errors.
- Node identity, stored annotation selector resolution, cleanup, duplicate processing, invalid time handling, and paragraph selection timing are covered by focused processor tests. Existing persisted user annotations were not read or modified; authenticated annotation persistence was not exercised.
- Initial real-page runs correctly failed before style corrections were complete. The final runs passed. Two expanded-test harness errors (regex escaping and including a separate speaker label in the text assertion) were corrected without changing application behavior.

## Visual evidence and acceptance

Before screenshots: unmodified live `.dev` page in Chrome, light mode, 1920×900 and 375×900. After screenshots: the final source in the complete local Nuxt app, the same public article, matching viewport/theme, with no preview CSS injection. Three focused groups show desktop reading, desktop contents, and mobile reading. The body crops exclude unrelated shell/side-panel details; the local shell locale differs from the live baseline and is not part of this change. Images are attached to the PR, never committed.

Final-source desktop/mobile screenshots were shown in the task conversation. The requesting user has not separately confirmed hands-on acceptance of that final source. The user's explicit instruction to open the PR is recorded as a review-before-final-acceptance instruction, not fabricated acceptance. Keep the PR draft and leave the acceptance task unchecked until confirmed.

## Local pre-push review

Change-id: `fix-youtube-style`. An independent read-only review and the coordinator's diff review applied all three `REVIEW.md` passes.

- Bugs: no Important source findings. Chapter buttons are appended without replacing existing paragraph text/heading anchors. Cleanup restores original timestamp attributes and removes listeners/controls. Normal mounted/unmounted lifecycle is covered; the direct processor rebind unit case does not claim the whole pipeline reruns after replacing the player.
- Security: no Important findings. No dependency, credential access, dangerous HTML insertion, or new external data flow. Button labels use `textContent`; seek values are finite nonnegative numbers.
- Compliance: source matches the revised reference and scoped delta. Validation is recorded here. Final-source human acceptance remains open and is explicitly deferred by the requested draft PR handoff, not marked complete.

## Delivery boundaries

No commit is made to a protected branch, no PR is merged, no dev/beta/production deployment is triggered, and no cache purge is performed. After the draft PR and screenshot attachments are confirmed remotely, stop this task's dev process and remove its worktree, generated dependencies/build caches, local replay data, temporary scripts/results, and task-created screenshot files. Preserve the remote branch and PR, the main workspace, unrelated worktrees, shared package stores, and user attachments. Post-merge deployment/acceptance and the final archive docs PR remain subsequent work.
