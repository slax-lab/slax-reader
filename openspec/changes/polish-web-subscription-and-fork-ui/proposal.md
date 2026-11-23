# Proposal

## Why

Reader Web feedback identified an undersized unread indicator, uneven inbox toolbar spacing, and tall metadata dividers in subscribed collections. Forked details also display attribution on a separate line with a bare `Fork:` label, which obscures the distinction between the original publication and the Reader copy.

The Feed follow-up addresses clipped source names, abrupt Newsletter disclosure, and bookmark filters carried into the Feed address.

## What Changes

- Show a 6px colored unread dot on subscribed avatars, with the surrounding separation ring outside the measured dot.
- When the subscribed avatar strip is visible in My Inbox, give the existing last-updated text more space from the avatars and bring it closer to the date groups or entries. Align the desktop list-mode control with the avatar centers.
- Match the subscribed-entry metadata dividers to the 12px dividers in the personal text list.
- Keep the existing Source pill and show localized Fork attribution beside it on one line in Forked Web details. Use a compact branch icon and copy such as “Saved from Alex.” Keep the original publication and the authorized Reader snapshot as separate navigation targets.
- Preserve the existing Source display for ordinary articles and the existing access and identity rules for Forks.
- Give Feed avatar text and source labels enough vertical room to render their glyphs while retaining horizontal truncation.
- Animate the Newsletter setup card's changing height and fading content during disclosure. Use immediate disclosure for reduced motion and e-ink.
- Clear bookmark-only search and filter parameters on a Feed tab click. Keep `view=rss`, preserve unrelated parameters, and continue accepting existing Feed links with a bookmark filter.

## Capabilities

### New Capabilities

- `web-collection-feed-presentation` covers the inbox avatar strip and toolbar, subscribed-entry metadata dividers, and the Web Feed source labels, disclosure, and tab query.

### Modified Capabilities

- `bookmark-fork` adds the single-line Web detail presentation to its existing safe attribution requirement.

## Impact

Reader Web inbox and subscribed collection lists, shared and private Reader headers, and English and Chinese Fork attribution strings. Source resolution, account and share access checks, Fork saving, API projections, storage, and other clients retain their existing behavior. The Fork presentation follows the already merged `enable-labs-on-fork` change on `dev`.

The change requester approved the three Web Feed additions on 2026-11-20, including compatibility with existing Feed links.
