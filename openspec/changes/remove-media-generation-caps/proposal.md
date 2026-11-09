# Proposal

## Why

A 3h19m podcast was rejected as `too_long` before transcription. Both media pipelines also refuse otherwise valid work because of content size, chunk count, estimated or accumulated spend, and daily quotas.

## What Changes

- Remove podcast and YouTube duration, total text, total chunk, per-run/per-episode, lifetime, site daily spend, and per-user daily start caps.
- Keep cost accounting, bounded provider requests, retries, concurrency, leases, access control, moderation, and output validation.
- Allow owners to explicitly retry records stopped by the removed caps without resetting their accumulated cost. Do not mass-requeue historical records.
- Delete enforcing code rather than adding flags, compatibility paths, or replacement large limits.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `podcast-article`: remove business caps and allow owner recovery after a cap rejection.
- `youtube-ai-article`: remove business caps and allow owner recovery after a cap rejection.
- `media-article-reliability`: admit plans independently of their total length or estimated cost.

## Impact

API media services, workflow runners, planning utilities, repository retry rules, and tests. No schema migration, provider change, new environment variables, or client package change is required. Existing API response shapes remain intact.

## Approval

On 2026-11-09 the user reviewed the concrete scope in conversation and selected both pipelines: remove duration, text amount, total chunks, single-article budget, daily budget, and daily user counts; retain request timeouts, finite retries, and concurrency controls. The user requested implementation and a PR, with merge and deployment remaining human-operated.

## Sequencing

This change follows the already merged media recovery and DeepSeek delivery changes present in origin/dev at 98221907. Their unarchived artifacts remain historical inputs; this change does not modify their implementations in parallel.
