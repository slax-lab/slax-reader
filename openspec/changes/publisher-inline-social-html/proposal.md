## Why

The content-save API forwards a publisher's supplied HTML to the capture workflow, but WeChat and X captures discard it and acquire a second copy. This can replace a complete editorial snapshot with different text or empty attribution.

## What Changes

For a fresh WeChat or X capture from an existing allowlisted publisher with supplied HTML, store the sanitized supplied body and its title, byline, site and publication time using the existing snapshot writer. Preserve Reader tweet markup for media and quoted posts. Recognize explicitly marked, preformatted ordinary publisher articles before probing the remote URL for PDF content. Preserve stored PDFs, PDF links and specialized media capture. Keep URL-only saves, ordinary users, existing completed bookmarks, moderation and other routes unchanged.

## Capabilities

- Modified: dynamic-article-capture.

## Impact

API capture only. No schema, credential, client, endpoint or binding changes.
