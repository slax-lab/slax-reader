# Proposal

## Why

An official WeChat article can have readable content after a legacy fallback fetch even when its HTML supplies no site name. The public Collection also leaves the source label blank for existing bookmarks with no site name, even when their host is known.

## What Changes

- Use `微信` as the saved site name when an official WeChat article is captured through the legacy fallback and its parsed site name is empty or whitespace.
- Preserve any nonblank site name extracted from the article.
- Display the saved host in the public Collection when a bookmark has no site name. Apply this to existing and newly captured bookmarks.

## Capabilities

### New Capabilities

- `wechat-article-capture` covers source attribution for official WeChat articles captured through the legacy fallback.

### Modified Capabilities

- `starred-collection-sharing` adds the saved host as a fallback for public Collection source labels.

## Impact

The change affects the API's legacy WeChat capture path, public Collection response, and Web Collection card. The Collection can display the host from historical bookmarks through its existing read path.
