# Design

## Context

The legacy branch of `parseAndSaveWeixin` passes fetched HTML into the shared capture pipeline. That pipeline selects a parser from the fetched URL and publishes its output through `saveParseRes`. The Collection query selects both `site_name` and `host_url`, and the response currently returns only the site name. The Inbox card already prefers the site name before the host.

## Goals / Non-Goals

Resolve the site name at capture time and use the resolved value in both stored metadata and the capture result. The capture scope includes the article parser's own fallback. Provide the saved host to the public Collection card for source labels on existing and new bookmarks.

## Decisions

Pass the WeChat default from the legacy branch through the existing capture pipeline. Apply it to the selected parser result before publishing metadata, and preserve a nonblank parsed value exactly. Applying the default after parsing covers parser branches that reconstruct HTML and keeps parser selection and quality scoring independent of attribution.

Project the already-selected `host_url` through the Collection response and its client type. Compute the label from the first nonblank value in `site_name` and `host_url`, then render it in the existing source span. Treat missing hosts in older responses as empty.

## Risks / Trade-offs

The fetched URL can differ from the URL that selected the WeChat route. Carry the default from the explicit legacy WeChat branch so redirects use the same attribution policy while retaining their existing parser selection.

Confirm that a site name takes precedence over the host and that a host-only card uses the established label rendering at narrow and wide widths.
