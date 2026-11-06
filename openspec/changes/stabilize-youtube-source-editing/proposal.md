## Why

In video fsTtKywmWlU the editor cited a mixed-speaker cue twice and moved a short reply past the next question. Two production runs rejected chunk zero. The user reviewed the fixed-passage design in conversation and requested implementation, tests and a pull request.

## What Changes

Generate target-language text directly from ordered source passages. Accept and checkpoint passages individually, repair only failed work with bounded retries, preserve progress across failures, and use extractive headings and introductions when optional model work fails. Preserve references, ownership and spend caps. The user approved this revised design in conversation on November 6, 2026.

## Capabilities

### New Capabilities
- `youtube-source-editing`: generation of source-bound paragraphs for edited YouTube articles.

## Impact

API workflow and temporary R2 checkpoints. No database migration or client contract change. Sequence archive with the existing YouTube article workflow changes.
