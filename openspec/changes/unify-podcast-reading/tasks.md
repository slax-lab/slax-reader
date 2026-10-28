# Tasks

## 1. Review and sequence

- [x] 1.1 Obtain proposal approval; record the approved scope and any requested optional demo before implementation.
- [x] 1.2 Integrate reviewed #405 and #406 changes into the isolated implementation branch; verify their baseline tests and keep earlier PRs unchanged.

## 2. Resolve episode links

- [ ] 2.1 Reproduce compact share-link and old Apple episode failures with tests; verify show pages and unsafe redirects remain excluded.
- [ ] 2.2 Fix Pocket Casts share resolution and Apple exact-episode recovery; verify canonical and shared links select the same episode.
- [ ] 2.3 Verify Xiaoyuzhou and existing RSS/direct-audio capture with live examples; record source metadata and playable audio without credentials.
- [ ] 2.4 Add Spotify public-source resolution and an explicit no-transcript result; verify full audio, embed-only, and preview-only cases.
- [ ] 2.5 Add Overcast and Castbox adapters using public episode metadata; verify a live episode and parser fixtures for each.
- [ ] 2.6 Add Amazon Music and Ximalaya public episode resolution; verify live public examples and restricted-source outcomes separately.
- [ ] 2.7 Verify equivalent episode inputs reuse existing work and that unrelated episodes never share results through title-only matching.

- [ ] 2.8 Check official linked YouTube captions before paid transcription; verify provenance, absent captions, and mismatched timeline controls.

## 3. Produce and save readable articles

- [x] 3.1 Add failing Podcast tests for missing/reordered cues, excessive shortening, and truncated output; share the YouTube checks and make them pass.
- [x] 3.2 Generate the introduction from the complete edited source; verify the prompt includes the final topic and translation preserves every paragraph.
- [x] 3.3 Version changed output while preserving old ready reads; verify disabled Labs, owner, visitor, private, and moderation cases.
- [x] 3.4 Distinguish failed publication from success; verify retries reuse canonical output and preserve annotated bodies.

## 4. Share the reading layout

- [x] 4.1 Share the YouTube reading styles and renderer hierarchy with Podcast; verify both media types preserve text and highlight targets.
- [ ] 4.2 Keep the player above original and translated articles; verify actual play, pause, seek, keyboard controls, and language switching.
- [ ] 4.3 Verify light, dark, and e-ink at 320, 375, 768, and 1,200 pixels; capture player-plus-article and reading screenshots.

## 5. Prove the complete result

- [ ] 5.1 Process a real Chinese and English episode through capture, transcript, editing, saved-body publication, and separate visitor reads; record each result separately.
- [ ] 5.2 Use one real publisher transcript and one real audio transcription; verify retries do not start duplicate paid jobs within existing budgets.
- [ ] 5.3 Inspect opening, middle, and ending passages against their source; verify preserved examples, questions, numbers, speaker evidence, and timestamps.
- [x] 5.4 Run affected API/Web tests, types, lint, generated-output checks, strict OpenSpec validation, and YouTube regressions; record commands and limits.
- [ ] 5.5 Complete Bugs, Security, and Compliance review; deliver screenshots and obtain human hands-on acceptance before the new PR.
- [ ] 5.6 Create the follow-up PR with platform results, real evidence, restrictions, and dependency order; request colleague review and resolve findings.
- [ ] 5.7 Archive through a documentation PR after the task PR merges and all preceding podcast capability deltas are archived; classify unchecked tasks first.
