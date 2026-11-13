# Validation — 2026-10-29

## Scope and source

Branch: `feat/fix-youtube-style`, based on `origin/dev` at `30feba75`. Only edited YouTube Web body presentation changes. The player sizing, sidebar, API, original captions, podcast source, manifests, and dependencies are unchanged. No CLI, Extension, or Mobile package/output is affected, so no packaged-app version decision is required.

The requesting user inspected the implemented YouTube body in the local Chrome preview and explicitly accepted its UI. The user reconfirmed that acceptance after reviewing PR #441 on 2026-10-29. That confirmation had already been received when the agent checked the repository at 09:59:25 UTC. This is a latest-observed bound, not a fabricated exact acceptance time. Scope is the YouTube body and its reference-aligned presentation; sidebar behavior and a real new-bookmark backend flow remain excluded.

PR #441 was created at 08:19:31 UTC before final-source hands-on acceptance. Its reviews correctly flagged that ordering. That original submission has now been closed, preserving its chronology and reviews. A replacement PR will be opened only after the already-recorded acceptance and this documentation update. The product code and tests are unchanged from accepted/revalidated source `6e84210e`; only delivery records change. Thus the new submission has its own post-acceptance creation event instead of pretending that #441 was compliant. No acceptance is backdated, no finding or history is deleted, no repository policy is weakened, and the replacement must pass normal CI and review. No merge or deployment is authorized.

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

Final-source desktop/mobile screenshots were shown, and the requesting user exercised the source build in local Chrome and accepted the YouTube body appearance. They reconfirmed that acceptance on 2026-10-29 before the replacement submission. Requested adjustments were reference-aligned chapter times, no paragraph playback decoration, and the subsequent minimal YouTube-only implementation. Sidebar behavior and a real new-bookmark backend flow are excluded. The old acceptance-after-opening sequence belongs specifically to closed PR #441; its review is retained as history. The replacement is submitted after this acceptance with unchanged product files.

## Local pre-push review

Change-id: `fix-youtube-style`. An independent read-only review and the coordinator's diff review applied all three `REVIEW.md` passes.

- Bugs: no Important source findings. Chapter buttons are appended without replacing existing paragraph text/heading anchors. In the minimized implementation original timestamp attributes are unchanged; cleanup removes only generated buttons and their listeners.
- Security: no Important findings. No dependency, credential access, dangerous HTML insertion, or new external data flow. Button labels use `textContent`; seek values are finite nonnegative numbers.
- Compliance: implementation matches the revised reference and scoped delta, with UI acceptance recorded before the replacement PR is opened. The Important historical ordering finding remains attached to closed PR #441, not silently waived or rewritten. Re-submission follows the required order and still requires a fresh automated verdict; this record does not claim that the new gate has passed.

## Delivery boundaries

No protected-branch commit, merge, deployment, or cache purge is performed. PR #441 is retained closed and cross-linked to its replacement. Initial cleanup completed; the user later requested a local preview, then stopped the preview window and service after inspection. Do not restart them without a request. Preserve the remote branch, both PR histories, the main workspace, unrelated worktrees, shared stores, and user attachments. Archive remains a separate post-merge documentation task.

## Minimal-diff follow-up and body acceptance — 2026-10-29

The requesting user inspected the actual source running in the independent local Chrome window and stated that the body looked correct. They separately challenged the sidebar push behavior and requested minimal YouTube-only treatment, then explicitly asked to continue. This is hands-on acceptance of the displayed YouTube body, not acceptance of the sidebar or proof of a new-bookmark backend flow. The earlier pending-acceptance notes describe the initial PR handoff and are superseded only for the body scope by this record. No claim is made that the user separately exercised every automated theme/width combination.

The follow-up removes 24 lines of runtime handling: the processor-wide WeakSet/context cleanup wrapper and the loop mutating paragraph timestamps' hidden, tabindex, and aria-hidden attributes. Existing paragraph timestamp nodes and attributes now stay unchanged; the already-scoped YouTube `display: none` rule alone hides them and excludes them from actual Chrome focus/accessibility output. Only generated chapter buttons get a local duplicate-control guard and cleanup. Existing contents/raw-caption/player handling is not wrapped or refactored. The CSS appearance itself is unchanged, so the existing before/after visuals remain representative.

Verification after minimization:

- Focused processor/component/podcast tests: 41 passed. Scoped ESLint passed.
- Full Web typecheck, `pnpm web -- test --maxWorkers=4`, and build all exited successfully: 224 files and 2,559 tests passed; 1 file/3 tests skipped.
- Compiled complete CSS cascade: 24 saved/expanded × theme × width combinations passed; ordinary/raw-caption/podcast negative controls unchanged. The fixture now uses original tabindex=0 attributes and verifies the hidden spans cannot receive focus.
- Real public article replayed into the full running application: saved and expanded paths each passed 12 combinations (375/768/769/1200px × light/dark/e-ink); all 85 paragraph texts match, 17 accessible chapter controls remain, timestamp attributes are unchanged, hidden spans cannot receive focus, Enter and Space emit one seek each (`[66, 66]`), contents navigation succeeds, and no page errors occur.
- No differences from the PR base in `apps/api`, generic article reset/content styles, `useSnapshotLayout`, layout components, or `pages/b/[id].vue`.

Local review follow-up: Bugs — generated buttons clean up independently and repeated chapter adaptation does not duplicate them; prior paragraph attributes and normal processor lifecycle remain intact. Security — no new HTML injection, requests, or dependencies. Compliance — same accepted visual behavior with a smaller implementation and no sidebar expansion. No Important findings from this minimization review.

Sidebar observation is recorded separately, not repaired here: the local fast-response preview can show an open transcript with layout `panelOpen=false`/push=0 at 1500px. Existing page code synchronizes the active panel and later resets panelOpen on mount; this PR does not change either block. The existing wide-screen rule also deliberately keeps centered content without a push when there is sufficient spare space. This observation is not evidence that all sidebar behavior has been verified or that the PR changed it.
