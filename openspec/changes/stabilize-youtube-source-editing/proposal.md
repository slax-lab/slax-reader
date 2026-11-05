## Why

In video fsTtKywmWlU the editor cited a mixed-speaker cue twice and moved a short reply past the next question. Two production runs rejected chunk zero. The user reviewed the fixed-passage design in conversation and requested implementation, tests and a pull request.

## What Changes

Assign ordered passages before editing. Batch model work, preserve questionable passages verbatim and checkpoint completed translations. Keep article rendering, ownership, spend caps and publication gates.

## Capabilities

### New Capabilities
- `youtube-source-editing`: generation of source-bound paragraphs for edited YouTube articles.

## Impact

API workflow and temporary R2 checkpoints. No database migration or client contract change. Sequence archive with the existing YouTube article workflow changes.
