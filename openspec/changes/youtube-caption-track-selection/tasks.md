# Tasks

## 1. Caption selection and acquisition

- [x] 1.1 Rank eligible TikHub tracks using the existing capture locale and both automatic-track markers. Verify order independence, Chinese and English preference, English fallback, manual priority, language tag variants, and the single-language rules in `test/infra/youtubeCaptionTrack.test.ts`. Exercise the capture call with a real `ContextManager` and verify that `zh-Hant`, `en-US`, and an empty locale reach the adapter as `zh`, `en`, and `en`.
- [x] 1.2 Share payload verification across explicit and asynchronous responses. Cover mismatched languages and video IDs, direct English or Arabic results, empty cues, one alternate request under the original timeout, and the player-only fallback in the caption adapter and capture flow tests.
- [x] 1.3 Record the chosen and returned languages and the reason for a player-only or degraded result. Verify that the existing bookmark save succeeds on provider failure and that the diagnostic record contains no caption text or provider URLs.

## 2. Verification

- [x] 2.1 Exercise the regular save flow in a running non-production environment for `y1-9yeYLJUo` and a single-language video. Verify the selected language in the saved caption metadata and reader transcript. Exercise an unavailable or mismatched caption response in the same running flow with a controlled provider response. Record commands, running evidence and any agent-executable gaps in `validation.md`.
- [x] 2.2 Run the focused API tests, API typecheck and lint, and `openspec validate --all --strict`. Record the results in `validation.md`.
- [x] 2.3 Record human hands-on acceptance of the reader-visible caption result in `validation.md` before opening a pull request. Complete the local pre-push review per `REVIEW.md`.
