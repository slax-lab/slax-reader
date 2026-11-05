# Validation — 2026-11-02

## Scope

The approved change is included in existing PR #449 on `fix/web-ui-switch-toolbar-lcp`, at the user's explicit request. The promotion runtime diff changes only two loading attributes, one import, and one page-local media query. The accompanying article follow-up is tracked separately by `optimize-web-lcp`; no deployment or production telemetry change is part of this work.

## Automated checks

- Full `index.vue` SFC parse, script compilation, and template compilation with the installed Vue compiler: passed.
- ESLint for `apps/web/app/pages/bookmarks/index.vue`: passed after sorting the added import with the existing autofix rule.
- `git diff --check`: passed.
- `openspec validate --all --strict`: 91 passed, zero failed on the PR branch. Existing informational requirement-length notices remain.
- Full Web delivery results are recorded in [the LCP follow-up validation](../optimize-web-lcp/validation.md#approved-bounded-follow-up-2026-11-02).

## Running-browser exercise

An ephemeral local Vite fixture extracted the exact changed promotion template, media-query declaration, and promotion CSS from the page. It used the installed Vue and VueUse implementations. Surrounding account/KOC values were controlled fixture inputs; no production account or promotion state was changed. Real Chromium iframe viewports provided independent breakpoint widths.

| Viewport / locale / eligibility | Image loading | Browser fetch priority | Visible |
| --- | --- | --- | --- |
| 390px / Chinese / eligible | lazy | auto | no |
| 920px / English / eligible | lazy | auto | no |
| 921px / Chinese / eligible | eager | auto | yes |
| 1280px / English / eligible | eager | auto | yes |
| 1280px / Chinese / ineligible | no image | not applicable | no |

The localized sources remained the original images. The fixture was rebuilt from the PR branch and all five cases were re-exercised. Evidence is stored outside Git in the current task's `promo-preview/followup-browser-results.json` artifact.

## Gaps and delivery checkpoints

- The full authenticated Nuxt application, activity API, and real claim interaction were not exercised. The currently available production account did not display the promotion during the preceding investigation.
- No measured production LCP reduction is claimed. The earlier startup and API waits are unchanged.
- No styles, theme tokens, accessibility names, dimensions, or click behavior changed. This loading-only supplement does not introduce a new UI design to accept. The existing PR's separate switch/toolbar UI acceptance remains recorded under `fix-web-ui-render-defects`; it is not claimed as acceptance of this follow-up. Full authenticated application smoke remains unverified for the reason above.
- Independent pre-push Bugs, Security, and Compliance review covers this change alongside `optimize-web-lcp`; see its follow-up review record.

## Tooling note

The fresh worktree initially lacked local executables. Checks reused the already installed, pinned source-checkout tooling through absolute paths and ignored node_modules links; no dependencies were installed or changed.
