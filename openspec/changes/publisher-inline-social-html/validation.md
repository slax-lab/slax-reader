## Runtime evidence

On 2026-11-17, replayed four collected HTML documents over loopback HTTP into the API capture workflow and its real publisher parser, sanitizer, image rewriter and snapshot writer call. The sample included a WeChat technology article (six images), an X status quoting a second author (six quote images), and two WeChat editions with distinct publication times. Each produced one snapshot, retained its supplied title, byline, credit block and image count, invoked moderation once and made zero platform-provider calls. Snapshot storage, provider services and moderation responses were local test adapters. No live bookmarks were created by this replay.

## Automated checks

The workflow suite covers allowlisted WeChat/status/article saves, ordinary users and blank input, rejected unsafe markup and downstream moderation. The existing Toutiao capture tests exercise the default article sanitizer. API type checking and strict OpenSpec validation are run before submission.

## Limits

This is a server-side ingestion change. No client renderers or layouts changed. No deployment or production recapture was performed; existing completed captures are not rewritten by this change.

The final targeted run covers 155 tests across the workflow and Toutiao suites, including marked ordinary and Weibo articles that never enters network acquisition. The full strict OpenSpec check passed (143 items). ESLint reported no errors.
