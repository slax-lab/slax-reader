# Repair the three reported bookmark snapshots

## Why

Feishu task t105556 also reports two site utility frames in a CAC snapshot (t105557) and an X Article saved under the author name with a provider profile card (t105581). The Reuters bookmark in t105601 contains only a request to enable JavaScript. Ordinary URL saves currently ask Zyte for the raw HTTP response on Reuters. The change requester wants Zyte to render the page before Slax extracts the article.

## What Changes

For regular URL saves on `www.reuters.com` and `reuters.com`, ask Zyte for browser-rendered HTML with JavaScript enabled. Route the rendered document through the existing article parser. Preserve the existing provider order and fallback request mode. If the only available content is the observed Reuters access notice, fail the capture before publishing a snapshot.

For regular URL-only captures on other sites, monitor short JavaScript enablement notices before publication. A notice after a raw fetch triggers one Zyte browser request. Record the site, normalized text length and outcome in Worker logs. A matching notice on a fallback target HTTP error is terminal, while a readable fallback body is still eligible for regular saving. The change requester reviewed the 120-character limit and single-attempt rule on November 23, 2026.

For CAC articles, discard the two reported same-origin utility frames during parsing. For the reported FxTwitter embed layout, capture the article title and authored body, including formatting and cover, and omit the provider thread and profile card.

## Capabilities

### New Capabilities

- `javascript-notice-recovery` covers detection, one browser retry and its observable outcome for regular remote saves.

- `snapshot-source-cleanup` covers the reported CAC and FxTwitter source markup.

- `reuters-article-capture` covers Reuters-specific provider selection and recognition of its access notice.

## Impact

The API regular bookmark and X Article capture paths are affected. Verify the CAC and X reports against the saved HTML and text. Verify the reported URL, an ordinary site's HTTP request, the existing fallback request and the stored article or failure outcome. Live evidence requires an environment with a configured Zyte credential.
