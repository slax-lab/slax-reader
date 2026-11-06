# Proposal

## Why

Video yP176MBG9Tk failed because a translated passage omitted an ambiguous source year (2019 followed by 2010), despite producing readable Chinese. The runner treated a numeric heuristic as proof of missing content and rejected the complete article. Video fsTtKywmWlU also exposed serial remote I/O and publication/indexing costs absent from local model-only timing.

## What Changes

- Replace the version-selected generation paths with one source-owned translation and rendering pipeline.
- Use deepseek-flash for all text generation in the YouTube and podcast article workflows, including editing, translation, headings and introductions. Fix the API base to https://api.deepseek.com and configure only DEEPSEEK_API_KEY. Keep unrelated application AI, speech transcription, moderation and search embeddings on their existing providers. No alternate translation service or provider fallback.
- Persist valid passage results independently. Treat number and length differences as diagnostics, recover missing or unusable results with smaller requests, and continue independent chunks when one is blocked.
- Render a complete base article with deterministic headings and introduction. Optional model enhancements must not block publication or overwrite translated paragraph text.
- Publish bookmark bodies before independent durable indexing and cleanup. Preserve permissions, marks, ownership checks, source identity, and spend limits.
- Validate both incident videos with the actual provider and exercise transport, content, restart, storage, ownership, accounting and publication failures locally before opening the PR.

The user approved the redesign in conversation on November 6, 2026, requested implementation and a PR, declined Google Cloud Translation, and selected deepseek-flash for both article-generation workflows and supplied https://api.deepseek.com as the API base, with a key to be supplied later. Provider verification remains pending until that key is available.

## Capabilities

### Modified Capabilities

- `youtube-ai-article`: source-owned delivery, provider selection, diagnostics, bounded recovery and independent publication work.
- `media-article-reliability`: YouTube numeric differences no longer gate delivery; both article workflows use DeepSeek without Gemini-specific thinking settings.

## Impact

API runner, translation utility, provider client, workflow wiring, media publication/indexing helpers and backend configuration/types. No new compatibility selector, client contract, UI layout, database migration, or deployment. This follow-up is sequenced after merged PR #520; archive its source-editing delta first or reconcile it in the same archive sequence so it cannot reinstate numeric hard gates.
