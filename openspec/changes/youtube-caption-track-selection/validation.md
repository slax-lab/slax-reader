# Validation

## Automated checks

- `pnpm api -- test test/infra/youtubeCaptionTrack.test.ts test/flow/addUrl/13-youtubeCaptionSave.test.ts test/utils/youtubeCaption.test.ts` passed all 59 tests.
- `pnpm api -- test test/script/layerArchitecture.test.ts` passed all 35 tests.
- `pnpm api -- test test/domain/youtubeArticleRunner.test.ts test/domain/youtubeArticleService.test.ts test/domain/crawlContent.test.ts` passed all 156 tests.
- `pnpm api -- typecheck` passed. Prisma clients were generated from the checked-in schemas for this worktree.
- `pnpm api -- lint` passed with zero errors and 344 warnings. Targeted lint reported four existing warnings in unrelated parts of `socialMedia.ts`. Prettier passed for all four changed TypeScript files.
- `pnpm exec openspec validate --all --strict` passed all 157 items. `git diff --check` passed.

## Running capture

On 2026-11-19 (Asia/Shanghai), ran the real `ContextManager`, TikHub adapter, `CrawlService.fetchYoutubeData`, and `CrawlService.parseAndSaveYoutube` in a local process. The harness supplied in-memory replacements for bookmark and object storage. A localhost HTTP endpoint served the generated reader HTML and reported the saved metadata and cue counts. The public YouTube metadata and TikHub calls were live for the primary check.

- `y1-9yeYLJUo` with capture locale `zh-Hant` passed `zh` to the adapter. TikHub currently listed `ar` first and `en` second. No tracks in that response carried an ASR marker. The selector requested `en`, TikHub reported `en`, and the saved caption object recorded `source_track: en` and `language: en`. The object contained 1,700 cues. The served reader HTML contained 1,689 transcript rows after the existing same-second merge, with zero rows containing Arabic-script characters.
- The same flow saved `jNQXAC9IVRw` with 6 English cues from the live provider. A controlled response exposing only Japanese automatic subtitles also preserved `a.ja` and displayed the timed Japanese cue under the single-language rule.
- A controlled response for `y1-9yeYLJUo` exposed `a.en` and `a.ar` and returned `a.ar` for the `a.en` request. The adapter logged `language_mismatch`. The save published a player with zero transcript rows and zero caption objects.
- A controlled capture of `y1-9yeYLJUo` with Arabic, English, and Traditional Chinese automatic tracks saved and rendered the Chinese track for `zh-Hant`.
- Automated fixtures cover the multi-language ASR preference in both list orders and the bounded alternate request. The live response for the reported video exercised the English fallback among unmarked tracks. Its historical provider response remains unavailable.

The running check used the backend publication code with in-memory persistence. Full deployed Worker, database, and Web app integration was outside that environment.

## Local review and acceptance

- Bugs. Reviewed the normal and asynchronous entry paths, selection order, fallback budget, compatibility cue rendering, and separation of absent tracks from provider failure.
- Security. Verified the existing vendor destination and that selection diagnostics use video IDs, bounded language codes, and fixed reason strings. Provider captions, response bodies, and signed track URLs stay out of the caption diagnostics.
- Compliance. The change matches the `youtube-captions` delta. The existing context locale, API contracts, frontend code, and storage formats are retained. Logic remains in the existing infra adapter and caption utility. The app-layer architecture check passed.
- On 2026-11-19 (Asia/Shanghai), the change requester opened the local preview for `y1-9yeYLJUo` and confirmed that the transcript below the player was in English. The requester accepted the result without requesting adjustments.
