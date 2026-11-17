## Why

The crawler currently schedules screenshot and AI extraction-quality checks for eligible bookmarks saved by editorial publisher accounts. These checks also generate operations alerts for automated imports.

## What Changes

Skip creation of the content validation workflow when the saving user ID matches the existing publisher allowlist. Apply the decision when a crawl reaches the validation dispatch point.

## Capabilities

### Modified Capabilities

- `content-validation-alerts` excludes publisher saves from validation dispatch.

## Impact

One dispatch condition in the Reader API crawl workflow reads the existing `PUBLISHER_USER_IDS` binding. Already scheduled validation jobs follow their existing lifecycle. Content moderation runs separately before this dispatch point.
