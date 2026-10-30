# Proposal

## Why

The YouTube reading styles introduced by `f50703b3` are loaded on the reported dev bookmark, but generic article resets override descendant typography and important spacing rules override the dedicated rhythm. Live macOS Chrome inspection confirms 28px paragraph line height instead of the article root's 33.3px, 24px paragraph top margins instead of zero, and 16px justified serif contents text instead of the dedicated compact sans-serif treatment.

## What Changes

- Restore the existing YouTube reading typography, alignment, and spacing within `[data-slax-derived="youtube-article"]`, including intermediate sections, contents entries, timestamps, and method notes.
- Match the user-supplied expanded-article reference: show one seek control beside each chapter heading, hide per-paragraph timestamps, and remove the saved body's playback background and accent edge. Preserve existing paragraph text nodes and annotation anchors; keep raw captions, podcasts, player, and sidebar unchanged.
- Apply the same dedicated typography to saved-body and separate expanded-article presentations, with an idempotent, cleanup-aware saved-body processor for chapter controls.
- Add regression checks for computed descendant styles, not merely declared font stacks, text presence, and document overflow.
- Exercise the actual reported article with the complete application CSS, show before/after Chrome screenshots, and obtain human hands-on acceptance before opening the PR.
- Work only in the isolated `fix-youtube-style` worktree on `feat/fix-youtube-style`; open one task PR to `dev`, then clean up this task's temporary caches and worktree after successful handoff. The current request does not authorize merging or deployment.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `youtube-ai-article`: require dedicated edited-article typography and spacing to remain effective inside the existing reader reset, with narrowly scoped non-regression for other content.

## Impact

Primary implementation owner: `apps/web/styles/article/_youtube-reading.scss`. Nearby article reset and content rules are evidence of the conflict, not permission for a global rewrite. Tests belong to the existing Web test setup and media-recovery browser fixtures. No API, data migration, runtime dependency, player, sidebar, application shell, raw-caption, or podcast redesign is included. No packaged CLI, Extension, or Mobile change is planned.

The follow-up is based on the merged `restore-media-article-recovery` implementation already on `origin/dev`; it is not a parallel redesign. That change still has an unarchived `youtube-ai-article` delta. Archive its existing delta first, or sequence both archives in dependency order without overwriting either requirement set.

## Delivery Boundary

Reported page: `https://r.slax.dev/b/980e2f6b-f36e-4658-9cf6-c5ade249cd30`. The latest instruction supersedes the earlier deployment request: implement in the new worktree, open a PR, and clean this task's caches and worktree after successful handoff. Do not merge or deploy. The coordinating agent owns full application verification, evidence, acceptance, review, PR creation, and cleanup; the implementation subtask owns scoped source, tests, and these planning revisions. Local screenshots must not be presented as proof that `.dev` has changed. Archive remains a separate post-merge documentation PR.

## Confirmed Reference and Implementation Approval

On 2026-10-29, the requesting user supplied a Linux reference showing the expanded `YoutubeAiArticle.vue` presentation: one chapter time beside each heading, no paragraph time labels, and no playback background. Read-only inspection of the reported saved body found 17 `section.slax-pod-section` elements and 85 `p.slax-pod-p` elements, with direct-text `h2#yt-topic-N[data-start-ms]` headings and paragraph-leading seek spans. The difference is the presentation path and CSS cascade, not an established Chrome-engine incompatibility.

The coordinating agent first showed a temporary DOM/CSS preview. Following clarification, the user instructed implementation and PR creation, which initially preceded final-source acceptance. After the requested cleanup, the user asked to reopen the source build in Chrome and accepted the YouTube body appearance on 2026-10-29. They separately reported sidebar push behavior and explicitly requested minimal YouTube-only changes, then approved continuing. Retain the restored preview for this review.

This refinement keeps the existing dedicated stylesheet and only the necessary chapter-control adapter: remove the processor-wide lifecycle wrapper, leave paragraph timestamp attributes unchanged, and hide those spans with scoped CSS alone. Do not add a sidebar repair, change the player, or alter generic article rules. Full automated checks and real-content browser verification are recorded in `validation.md`; the user's acceptance is limited to the displayed body, not the sidebar or a real new-bookmark backend flow. No merge or deployment is authorized.
