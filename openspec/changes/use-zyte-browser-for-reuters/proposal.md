# Use Zyte browser rendering for Reuters articles

## Why

The Reuters bookmark in Feishu task t105601 contains only a request to enable JavaScript. Ordinary URL saves currently ask Zyte for the raw HTTP response on Reuters. The change requester wants Zyte to render the page before Slax extracts the article.

## What Changes

For regular URL saves on `www.reuters.com` and `reuters.com`, ask Zyte for browser-rendered HTML with JavaScript enabled. Route the rendered document through the existing article parser. Preserve the existing provider order and fallback request mode. If the only available content is the observed Reuters access notice, fail the capture before publishing a snapshot.

## Capabilities

### New Capabilities

- `reuters-article-capture` covers Reuters-specific provider selection and recognition of its access notice.

## Impact

The API regular bookmark fetch and save paths are affected. Verify the reported URL, an ordinary site's HTTP request, the existing fallback request and the stored article or failure outcome. Live evidence requires an environment with a configured Zyte credential.
