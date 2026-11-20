# Verification

## Automated checks

- Installed the Web workspace and dependency packages with `pnpm --filter @apps/slax-reader-dweb... install --frozen-lockfile`.
- `pnpm --filter @apps/slax-reader-dweb typecheck` passed.
- `pnpm --filter @apps/slax-reader-dweb exec vitest run` passed 3,163 tests across 257 files. Three tests in one skipped file were skipped by the suite.
- The six focused article, PDF, source attribution, layout switcher, and bookmarks-page test files passed all 99 tests after the final CSS adjustment.
- ESLint passed for the changed Vue and TypeScript files. `git diff --check` passed.
- `pnpm exec openspec validate --all --strict` passed all 160 items.

## Running Web application

On 2026-11-20, Chromium exercised the running Nuxt app on port 3239. The opt-in acceptance layer supplied synthetic content, API responses, and disposable browser-local PowerSync rows. The Web router, components, styles, and PowerSync queries remained active.

- Opened My Inbox with a read and an unread subscription. Measured a 6 × 6px colored dot with its border outside the content box. Selecting the unread subscription switched its selected state and cleared the dot through the existing read behavior.
- Checked the list-mode group against the avatar centerline in light, dark, and e-ink on desktop. The timestamp started 16px below the avatar and the first date label retained its 16px top inset. Switched to text mode, entered and cleared a source filter at 768px, visited the collection, returned to My Inbox with the selected mode retained, and opened a fresh inbox without subscriptions.
- Checked complete, source-only, and highlight-plus-source metadata in the virtualized collection and server-rendered fallback. Only adjacent visible fields had dividers, each measuring 12px. The fallback used the same compiled component styles in the check.
- Checked the Fork header at 320, 768, and 1280px in all three themes. Both items shared a centerline. Long names truncated without horizontal overflow, including when the site name was long and the source owner was hidden. The source link kept its external destination and the Fork link opened the Reader snapshot. Checked keyboard focus and the mobile Fork link's 44px touch height.
- Compared the ordinary source link's geometry with and without the layout-neutral wrapper. Its position and size matched and the Fork marker was absent. Exercised a Newsletter source, uploaded and URL-backed PDFs with loaded page canvases, the unavailable and neutral Fork states, a generic Reader label for a hidden owner, and private access through the legacy share redirect.
- An anonymous request received neutral server-rendered attribution and no owner name after an authenticated visit. The private detail returned HTTP 403 without a session. A public copy with an unavailable source stayed readable and showed a plain label without a snapshot link.

## Web Feed follow-up

- The Web suite passed 3,165 tests across 257 files after the first Feed implementation. Three tests in one skipped file were skipped by the suite.
- After the final navigation and accessibility adjustments, Web typecheck and all 176 tests in 11 focused files passed. ESLint reported zero errors and 28 existing warnings. Strict OpenSpec validation passed all 160 items.
- In the same running Nuxt app, Chromium measured fallback text and labels with accents and descenders in the mixed Feed at 320, 768, and 1280px across the three themes. The text fit vertically and long names retained horizontal ellipsis. The RSS-only view passed the same typography check at 320px.
- Sampled intermediate animation frames on collapse and expansion for a configured Newsletter address. Both the section height and details opacity changed, and Copy stayed visible. The unconfigured card animated, restored the collapsed preference on reload, and focused its input when reopened from the summary. Reduced motion and e-ink switched immediately.
- Opened existing Inbox and tag-filter Feed addresses. Verified that clicking Feed removed bookmark-only filters and retained unrelated parameters and the hash, and that clicking Inbox or Tags opened the selected bookmark view.

## Human hands-on acceptance

On 2026-11-20, the change requester exercised all seven changes in the running [local acceptance preview](http://127.0.0.1:3239/ui-acceptance) and accepted them before the task pull request. They checked the 6px unread dot, inbox spacing and list-mode alignment, the 12px subscribed-entry dividers, the single-line Fork header and ordinary Source display, Feed avatar text, Newsletter disclosure, and Feed routing with older links. They reported no issues and requested no adjustments.

## Local pre-push review

The Bugs pass identified an overflow when a Fork has no Source and its owner has a long display name. Added a width cap and rechecked the running header in Chromium at 320px. The sole attribution stayed within the 288px row and its name ellipsized. The same attribution occupied 130px alongside Source. Web typecheck and the full suite passed on the final code, with 3,165 tests passed and 3 skipped. The Security and Compliance passes found no outstanding Important issues.

## Remaining coverage

Live sign-in, backend synchronization, and production share-permission transitions were outside the synthetic environment. The automated Web suite exercised cache isolation and the existing app regression checks.
