# Contributing to Slax Reader

[中文](README.md) · [Documentation](../README.md) · [Developer setup](development.en.md)

You can help by describing confusing behavior, reproducing a bug, improving a translation, or clarifying a guide. Programming experience is not required.

## Choose a starting point

| Contribution | First step | Local setup needed? |
| --- | --- | --- |
| Report a bug | Search [existing issues](https://github.com/slax-lab/slax-reader/issues), then choose Bug report | No |
| Suggest an improvement | Open a [Feature request](https://github.com/slax-lab/slax-reader/issues/new?template=feature.yml) and explain the task you want to complete | No |
| Fix a typo or wording | Use the GitHub editing steps below | No |
| Help test a change | Comment on its PR and ask the author for a test URL or extension build | No for a website; an extension needs to be loaded manually |
| Change code | Follow [developer setup](development.en.md) | Yes |

An issue is a discussion about a problem. A pull request (PR) asks maintainers to review and merge proposed changes. Chinese and English are welcome. If you cannot find the right file, describe the problem in an issue.

## Report something reproducible

Use [Bug report](https://github.com/slax-lab/slax-reader/issues/new?template=bug.yml), choose Web or Browser Extension, and include:

```text
Location: extension sidebar, English interface
Environment: browser/version; extension version, or website URL and time observed
Steps: 1. Open an article 2. Click… 3. Observe…
Expected: …
Actual: …
Frequency: always / sometimes
Attachment: screenshot showing the relevant area, if useful
```

If the Web version is unknown, enter “Hosted Web, observed at…” in the required version field. For suggestions, focus on what you are trying to do and what gets in the way. Remove private articles, account details, cookies and tokens from screenshots and logs.

## Make a small edit on GitHub

1. Select `dev` in the repository's branch selector and open the file. While this migration is not yet on `dev`, use the migration author's designated branch and target `feat/integrate-slax-reader-web-extension` with your PR.
2. Click the pencil button. Without write access, GitHub will guide you through creating a fork, your own copy of the repository.
3. Change only the relevant wording. Inspect the diff; use Preview for Markdown formatting.
4. Propose the change on a new branch, such as `docs/fix-reader-wording`. Do not commit directly to `dev`, `beta`, or `main`.
5. Open a PR against `slax-lab/slax-reader`, verify its base branch, and describe the original wording, replacement, reason and location.
6. State what you checked, for example: “Checked Markdown preview; did not run locally; please help verify the UI.” Do not mark checks as complete when you did not run them.

This route fits a trivial, single-file wording fix. Discuss larger translations, multi-file changes or behavior changes in an issue, then use the [local workflow](development.en.md) with a collaborator if needed. Documentation and typo-only PRs may use `OpenSpec: n/a`. Features, APIs and behavior fixes need a reviewed OpenSpec proposal first; maintainers can help with that process.

## Find text and translations

| Content | Chinese | English |
| --- | --- | --- |
| Web interface | [zh.json](../../apps/web/i18n/locales/zh.json) | [en.json](../../apps/web/i18n/locales/en.json) |
| Extension interface | [zh_CN.json](../../apps/extension/src/locales/zh_CN.json) | [en.json](../../apps/extension/src/locales/en.json) |
| Contributor documentation | [Chinese entry](README.md) | This guide and [developer setup](development.en.md) |

Search for the wording you saw. Edit the displayed value after the colon, keeping the key, quotes, commas and braces intact. Web and Extension have separate translations. Adding languages or changing keys needs developer involvement.

Web uses placeholders such as `"comment_placeholder": "Reply to {username}"`; the extension uses `"comment_placeholder": "Reply to $1"`. Keep each placeholder exactly as it is, and preserve existing `\n` line-break markers. Include the language, location and before/after wording in your PR. If you cannot run the app, ask the author to check truncation and variable substitution.

Discuss changes to pricing, privacy or legal meaning first. Files in [Web product content](../../apps/web/open_docs) appear directly in the product.

## See the result

GitHub's Markdown Preview checks document formatting; editing JSON does not create a product preview. This migration does not provide automatic PR preview deployments or a backend-free demo. Ask the author for an existing test environment, screenshots or an extension build tied to the PR's commit. The [hosted product](https://r.slax.com) helps describe existing issues but may not contain your changes.

Reading, reporting and editing text online require neither Xcode nor Node.js. Local native dependencies may require platform build tools; see [remaining verification](../migrations/final-verification.md).

Follow the [Code of Conduct](../../CODE_OF_CONDUCT.md). See [LICENSE](../../LICENSE), [NOTICE](../../NOTICE), and the [migration record](../migrations/slax-reader-web-extension.md) for imported code attribution and trademark guidance.
