# Proposal

## Why

Slax Reader already recommends public Collections and returns a few readable articles from each one. Readers need a place to explore those results and choose an article or Collection to open.

## What Changes

- The requester selected backend card ordering, cross-card deduplication with replacement, default server-selected leads and content-sensitive age discounts. Explicit topic browsing remains available.

- Favor recent reading matches across every card. Use the stored publication time to age ordinary stories as well as news and limit unscored reserves to recent publications.
- Add Discover to Web Labs and to the library navigation for readers who enable it.
- Surface shared reading topics with links into distinct recommended Collections. Readers can switch topics or see more Collections discussing the same topic.
- Ask the existing service for up to three readable members per Collection, ranked by the reader's article affinity, publication age and diversity.
- Lead with recommended Collections and show two or three directly readable member articles beneath each name. Give single-member Collections a compact section at the end of the feed.
- Include the publisher site and a short description when projecting a recommended Collection member. Older responses remain usable.
- Explain a cold start separately from an empty result or a request failure.

## Capabilities

### New Capabilities

- `discovery-plaza` gives App readers and opted-in Web readers a page for exploring recommended Collections and their member articles.

### Modified Capabilities

Existing Collection recommendation eligibility, ranking and feedback semantics continue to apply.

## Impact

The Web application, Labs registry and shared types for the existing Collection recommendation response are affected. The existing service supports a Discover representation on its Collection endpoint, with bounded member-vector readback. The change requester requested a working preview before documenting the behavior. After trying the first preview, the change requester asked for more immediately readable choices and recommendations they can explore by topic. The final editorial layout was accepted as recorded in validation.md.

## Editorial direction approval

On November 18, 2026 the change requester reviewed three clickable layouts and selected B, the editorial front page. The demo used the same ranked snapshot in all variants, supported opening Collections and stories, and covered 320, 390, 768 and 1120 px, light, dark and e-ink, plus loading, cold start, empty, disabled and retry states. The requester extended this direction to a Mobile Discover page and a Discover entry in the Web sidebar's Labs section. Implement the asymmetric lead treatment with a stacked mobile layout and preserve the recommendation order. The requester subsequently accepted the implementation and authorized a pull request to dev.
