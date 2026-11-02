# Validation

## Change log: 2026-11-02

Added `pca.st` to the existing short-link resolver. The classifier and capture workflow remain unchanged.
Branch: `fix/resolve-pocket-casts-short-links`, from `origin/dev` at `cfd51f55`.

## Root cause evidence

- The reported bookmark identifies its source as `https://pca.st/6rpkp8cj` and displays episode notes without a player.
- The source URL returns HTTP 302 to the canonical Pocket Casts episode ending in `d5287eb5-5416-4c58-9b7c-d1ba6d7f8fc8`.
- `CrawlService.shortLinkDomains` excludes `pca.st`; the resolver returns the original short URL without fetching it.
- `classifyPodcastUrl` accepts `/episode/<UUID>` on `pca.st` but rejects the reported opaque short code.
- The workflow tests podcast classification after short-link resolution. This omission sends the reported link through normal page capture.

Public redirect check:

```sh
curl --silent --show-error --max-time 20 --dump-header - --output /dev/null https://pca.st/6rpkp8cj
```

Result on 2026-11-02: HTTP 302, with a canonical episode URL in `Location`.

## Planning checks

- `pnpm exec openspec status --change resolve-pocket-casts-short-links`: all four planning artifacts complete.
- `pnpm exec openspec validate --all --strict`: 94 passed, 0 failed.
- `git diff --check`: passed.
- Writing review: five documents passed with zero warnings. The 18 style notices concern required OpenSpec scenario labels.

## Automated checks

| Check | Result |
| --- | --- |
| Resolver regressions before the fix | 8 failed, 8 passed |
| New workflow regressions before the fix | 3 failed |
| Four focused parser, capture, resolver, and workflow files | 185 passed |
| `pnpm api -- test` | 199 files passed; 14 skipped. 2,728 tests passed; 113 skipped |
| `pnpm api -- typecheck` | Passed |
| `pnpm api -- lint` | 0 errors; 344 warnings |
| `pnpm api -- gen:all` | Passed; no tracked generated drift |
| `pnpm exec openspec validate --all --strict` | 94 passed, 0 failed |
| `git diff --check` | Passed |

Generation used the public example configuration, local placeholder database URLs, and `SLAX_API_SKIP_DOTENV=1`.
The initial sandboxed suite could not create local sockets and subprocess pipes. The complete suite passed with local socket access.
The worktree uses the existing installed dependencies with its own pnpm task-state directory.

## Running environment

The patched `CrawlService.resolveShortLink` ran against the live short URL through Node and returned its canonical episode URL.
The browser rendered that destination. The actual parser consumed its episode metadata, notes, and download anchor.
The parser returned the reported title, show `高能量`, duration 8,400 seconds, and audio hosted by `dts-api.xiaoyuzhoufm.com`.
It found no supported publisher transcript.

The actual `HtmlBuilder.buildPodcast` generated a player body from that parsed data.
The running Nuxt application displayed this body through its existing bookmark page and player.
A temporary local middleware supplied the generated body and public bookmark metadata. It is excluded from the task commit.
The preview does not represent a completed production capture or generated transcript.

The browser clicked Play. The audio advanced from 11.39 seconds to 40.14 seconds before Pause.
It reported `readyState: 4`, duration 8,457.6 seconds, and no media error.
The rounded source duration and exact playback duration differ by 57.6 seconds.

Visual checks covered light and dark at 320 CSS pixels, plus e-ink at 1,280 CSS pixels.
At the checked light narrow width and e-ink desktop width, document width equaled viewport width.
Screenshots remain outside Git. The preview changes no application style or layout.

## Local review

- Bugs: the real resolver feeds the classifier and workflow regressions. Labs gating, show-page fallback, bookmark identity, and annotations retain coverage.
- Security: existing public-fetch validation rejects private addresses, URL credentials, and non-HTTP destinations before fetching them. No dependency or credential was added.
- Compliance: the diff implements `resolve-pocket-casts-short-links`. The earlier Pocket Casts implementation is merged; archive ordering remains explicit.
- No Important code findings. Pre-PR human hands-on acceptance remains pending and prevents PR creation.

## Verification limits

The public bookmark view does not establish the owner's Labs setting or prior capture logs.
No production bookmark changed. Production provider capture, owner recapture, and paid transcription were not exercised because this environment has no configured backend services.
Workflow and identity tests use service mocks. Real redirect resolution and real audio playback do not establish database persistence or final article generation.
The local preview logs a missing backend service for ancillary visit tracking; this does not establish a production failure.
No client package or contract changed. API releases do not require package-version increments.

Luca approved implementation on 2026-11-02. Human hands-on acceptance remains pending.
