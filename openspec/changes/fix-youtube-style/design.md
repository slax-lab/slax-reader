# Design

## Context

See `proposal.md` for the observed defect and delivery scope. The same `youtube-reading` mixin is included in the saved-body `.article-detail.default` stylesheet and the scoped `YoutubeAiArticle.vue` presentation. `_reset.scss` assigns typography directly to intermediate elements; `_content-mixin.scss` supplies important spacing, including structural first-child selectors. Raising only the article root's specificity cannot restore inheritance through those intermediate elements, and normal margins cannot defeat important margins.

The existing browser evidence checks a declared font stack containing Inter, not the actual rendered font. On the reported macOS Chrome page, body text uses the platform sans-serif and contents text uses the self-hosted Source Serif Pro. A Linux-versus-macOS engine incompatibility has not been established.

## Goals / Non-Goals

**Goals:** Preserve the intended dedicated reading presentation through both markup paths, and prove it with the complete CSS cascade and actual saved article.

**Non-Goals:** No global reset rewrite, new font download, generic typography redesign, moving/replacing existing content nodes, content regeneration, backend changes, sidebar changes, or player changes (including its 440px maximum width). Runtime chapter-control augmentation is explicitly permitted; rebuilding the saved body is not.

## Decisions

### 1. Keep the correction inside the dedicated mixin

Use `[data-slax-derived='youtube-article']` as the boundary in `apps/web/styles/article/_youtube-reading.scss`. Explicitly establish inherited typography and start alignment through section, details, nav, span, and other relevant text wrappers. Retain compact introduction labels and method notes. Avoid universal resetting that would strip annotation styling.

Alternative rejected: changing the generic article reset or introducing an application-wide cascade-layer scheme. Both expand the blast radius beyond this defect. Changing only source order is insufficient because inheritance and important declarations are involved.

### 2. Align both body paths while preserving existing text nodes

Use 18px sans-serif paragraphs with 1.85 line height (33.3px), zero top margin, and 20px bottom spacing. Headings use 26px serif text, 1.4 line height, 44px top and 20px bottom margins. Contents use 14px sans-serif/start-aligned text; chapter controls use 12px accent text. Section margins must not double-count chapter spacing. Defeat conflicting important structural margins only on the exact edited-article sections, headings, and paragraphs. Do not remove generic important rules globally.

For saved bodies, `YoutubeProcessor` appends a native `button.slax-yt-chapter-time` to each existing `h2.slax-pod-heading[data-start-ms]`. Keep direct heading text, IDs, paragraph nodes and descendants, text ranges, and annotation selectors intact. Format milliseconds as `m:ss` (or `h:mm:ss`) and dispatch the existing `slax:youtube-seek` bridge in whole seconds, matching the expanded component. Native buttons supply Enter/Space activation and visible focus; no duplicate key handler is added.

Hide existing paragraph seek spans with scoped CSS, `hidden`, `tabindex=-1`, and `aria-hidden=true`; retain their nodes and restore the original attributes on cleanup. Do not bind the podcast paragraph follower to edited YouTube bodies. Suppress playback backgrounds and accent edges inside this boundary, including stale playing classes. Leave raw-caption seeking and podcast behavior untouched. Repeated processing must not duplicate buttons or listeners; cleanup removes generated controls/listeners and allows rebinding. The expanded component keeps its existing chapter-button event binding and consumes the same body-local styles.

### 3. Test computed rendering, not CSS strings alone

Use the existing Nuxt/Vitest and Playwright tooling without adding dependencies. Add regression coverage for nested section line-height inheritance, paragraph and heading spacing, contents descendant size/alignment, and unaffected control content. Verify both saved-body and expanded-article paths under full application styles. A declared font-family match does not establish the actual font; record resolved fonts when browser tooling supports it, but do not require pixel-identical cross-platform font metrics.

Exercise 375px, 768px, 769px, and 1200px widths in light, dark, and e-ink. Assert the computed paragraph line height is approximately 33.3px, the paragraph top margin is zero, and contents labels are 14px/start-aligned. Check overflow, wrapping, focus, contents navigation, timestamp keyboard activation, and unchanged text/annotation targets. Compare ordinary articles, raw captions, and podcast content as negative controls.

### 4. Verify the actual article before PR handoff

Run the normal Web development path documented in `docs/web/development.md` first. Use read-only access to the reported `.dev` bookmark for a local preview of the same saved body. Disclose any fixture/proxy transport substitution; do not generate a replacement article or write to the remote bookmark. Capture matched before/after crops of the introduction, contents, chapter controls, paragraphs, and method notes at desktop and mobile widths. Screenshots stay outside Git. The coordinator owns running-application evidence, full checks, and human hands-on acceptance; the temporary preview approval is not final-source acceptance.

After acceptance, the coordinator runs `REVIEW.md`'s three local pre-push review passes and opens one task PR targeting `dev` with `OpenSpec: fix-youtube-style`. The latest instruction ends at successful PR handoff and cleanup of this task's caches/worktree. Do not merge or deploy.

## Risks / Trade-offs

- Strong legacy structural selectors can still win on nested nodes → verify computed values with the complete production-style cascade, not an isolated mixin preview.
- Fixing line height changes wrapping and article height → preserve content identity and test anchors/selection plus matched screenshots.
- Platform font fallback differs → retain the approved font stack and use geometry/readability checks instead of claiming font parity.
- Two rendering paths have different scoped selectors → exercise both, not only the reported saved-body path.
- The predecessor's capability delta remains unarchived → sequence archive after `restore-media-article-recovery`, never overwrite its requirements.

## Migration Plan

No data migration or API change is required. Keep implementation in the isolated worktree; do not modify the main workspace. Do not change `dev`, `beta`, or `main` directly. PR creation and task-cache/worktree cleanup belong to the coordinator after verification. A later owner may merge and archive through the normal repository process; archive is explicitly deferred to a post-merge documentation PR, with unchecked work classified first.
