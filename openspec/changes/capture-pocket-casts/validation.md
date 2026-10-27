# Validation — 2026-10-27

## Change log

Pocket Casts episode links now enter podcast capture when podcast Labs is enabled. The parser extracts safe audio, title, show, duration, notes, and supported transcript links. The existing source identity and save flow remain in use. Recapture refuses to replace a body with existing highlights or comments.

Branch: `fix/capture-pocket-casts`. Base: `origin/dev` at `f217f465`. This change needs the response-header fix before production browser verification.

## Automated checks

| Check | Result |
| --- | --- |
| Initial parser regression run | 10 failed, 54 passed before the fix |
| Initial capture regression run | 2 failed, 17 passed before the fix |
| `pnpm api -- test` | 192 files passed; 14 skipped. 2,518 tests passed; 112 skipped |
| `pnpm api -- test test/utils/podcastSource.test.ts test/flow/addUrl/15-podcastSave.test.ts` | 83 tests passed after restricting untyped transcript links |
| `pnpm api -- typecheck` | Passed after the final parser change |
| `pnpm api -- lint` | No errors; 344 warnings |
| `pnpm api -- gen:all` | Passed with example configuration and local placeholder database URLs |
| `pnpm exec openspec validate --all --strict` | 79 items passed |
| `git diff --check` | Passed |

The dependency generator added the `MarkRepo` constructor argument. No generated file was edited by hand.

## Running environment

Opened the reported short link in the browser:
`https://pca.st/episode/f7269801-ce3f-48fc-9e57-3783fdbbe7d2`.

It resolved to the canonical Pocket Casts episode page. The new parser read a captured rendered DOM from that live page.

- Title: `Vol.238 宏观漫谈112｜全球资本市场，集体“缺钱”？`
- Show: `高能量`
- Audio host: `dts-api.xiaoyuzhoufm.com`
- Page duration: 5,160 seconds, from the rounded `1h 26m` display.
- Publisher transcript references: zero. The HTML transcript viewer was excluded.
- Language: unset. The site's English interface does not determine the audio language.

The actual `HtmlBuilder.buildPodcast` generated the player body. The running Nuxt application rendered that body through its existing media processor. Playwright clicked Play. The audio reached `readyState: 4`, advanced its position, and reported an exact duration of 5,206.4 seconds. The browser reported no page errors. Desktop and 320-pixel screenshots showed the player and notes.

Local evidence: `/tmp/pocket-live-result.json`, `/tmp/pocket-body.html`, `/tmp/pocket-browser-results.json`, and `/tmp/pocket-player-desktop.png`. Screenshots remain outside Git.

## Local review

- Bugs: verified short and canonical episode recognition, show-page exclusion, missing audio, shared source identity, and existing bookmark identity. Capture tests verified annotation refusal before writes.
- Security: audio, cover, and transcript URLs use the existing outbound URL screen. Credential-bearing, private, and non-HTTP media URLs are rejected. The parser does not execute source scripts.
- Compliance: this diff implements `capture-pocket-casts`. Review found that untyped transcript links could be mistaken for VTT. The parser now requires a supported type, except native caption tracks. The regression test passes.
- No unresolved Important code findings. Human acceptance remains a delivery gate.

## Limits and remaining acceptance

Direct HTTP fetching returned a target 403. The browser rendered the source page. The existing provider fallback remains unchanged; a production Zyte or ScrapingBot fetch was not verified.

The live check parsed rendered source data and played real audio. It did not run a production crawl workflow, write production rows, start paid transcription, or produce the final cleaned article. Status responses in the local Web preview were fixtures. Production owner Labs settings remain unverified.

Annotation refusal uses the existing pre-write mark check. It does not add a transaction that prevents a simultaneous new annotation. This concurrency limit also applies to the existing publication flow.

After deployment, enable podcast Labs and save the original source link again. The existing save flow retains the bookmark identity. A bookmark with annotations must keep its current body.

Human hands-on acceptance is pending under `DESIGN.md` section 10.2. The `Pocket Casts player preview` tab exists in a dedicated Chrome preview window on M2-MBP. Exercise playback before opening the PR. Record the reviewer, date, and adjustments here. Final production transcription remains a separate verification gap.

Archive after the task PR merges. Sequence archive after the already-merged bookmark-fork delta for `podcast-article`.
