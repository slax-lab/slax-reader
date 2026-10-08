# Toutiao capture with TikHub

Run the standalone capture command from the repository root. It shares URL resolution and provider capture with bookmark saving, and does not need running Workers or databases. Credentials come exclusively from the process environment; the command does not load configuration or secret files.

If the token is already a fish variable, export it to child processes without printing it:

```fish
set -gx TIKHUB_TOKEN $TIKHUB_TOKEN
pnpm api -- debug:toutiao 'https://m.toutiao.com/is/CI_XBMsL7IU/'
```

From another shell, use the existing fish environment:

```sh
fish -lc 'set -gx TIKHUB_TOKEN $TIKHUB_TOKEN; pnpm api -- debug:toutiao https://www.toutiao.com/article/7450114952884503059/'
```

The default output is `.local/toutiao-capture/<article-id>/` at the repository root, regardless of the command's working directory. This directory is ignored by Git. Each capture writes `capture.json` (normalized metadata and character counts), `article.html` (sanitized article document), and `article.txt` (readable body). The summary prints the canonical URL, metadata, and output directory. To select another directory:

```fish
pnpm api -- debug:toutiao 'https://m.toutiao.com/is/CI_XBMsL7IU/' --output .local/toutiao-capture/sample
```

Relative output directories are resolved against the repository root. Choose an ignored local directory for capture artifacts.

Article URLs support exact hosts `toutiao.com`, `www.toutiao.com`, and `m.toutiao.com`, with paths `/article/<id>`, `/group/<id>`, `/a<id>`, and `/i<id>`. Tracking queries and fragments are removed. IDs remain strings, including IDs larger than JavaScript's safe integer range.

Share URLs support `t.toutiao.com`, `toutiaolink.com`, `www.toutiaolink.com`, and `m.toutiao.com/is/<code>/`. Resolution uses GET requests and at most five HTTP redirects, with a ten-second timeout per request. Each destination must remain a supported Toutiao article or share URL. A challenge page without a redirect, expired link, loop, or unsupported destination fails explicitly. No TikHub token is sent to share hosts. These supported forms have mocked coverage; live acceptance currently covers `m.toutiao.com/is/`, not every share host.

The body comes from TikHub's [Web article endpoint](https://docs.tikhub.io/246997250e0), with the article ID supplied as `aweme_id`. The [App endpoint](https://docs.tikhub.io/251380586e0) returned metadata without the body during discovery and is not used. Provider success alone is insufficient: missing bodies, deletion flags, and deleted-content placeholders fail. No generic scraper fallback runs for supported Toutiao captures.

Live provider requests can consume TikHub credits. Run them deliberately; routine automated tests mock the provider and redirects. Missing `TIKHUB_TOKEN` and other failures exit with a nonzero status. Captures contain no authorization material, and error output omits raw provider responses.
