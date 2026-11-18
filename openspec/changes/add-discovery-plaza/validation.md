# Validation

## Collection feed preview

On November 18, 2026, the built Web page ran on loopback. The local Labs API served the preview account's switch. For the recommendation request only, the preview forwarded an authenticated GET to the change requester's designated production origin, `https://api-reader.slax.com/v1/recommendations/collections`. The preview kept that credential in process memory. The returned candidates and their ordering came from the deployed recommendation service.

- The recommendation request with a limit of 36 returned HTTP 200 with 31 Collections and 75 readable member previews. The main feed showed all 25 Collections with two or three previews, totaling 69 articles. The six remaining single-member Collections appeared under Single reads. Browser checks compared every Collection in the grid and every member link in both sections with the response.
- The first complete Collection and its three articles fit in the first viewport at 320, 390, 768 and 1280 CSS pixels. At 1280 × 900 the first four Collections and their twelve member articles were visible. Scrolling reached later Collections, the Single reads shortcut reached the final section, and the article and Collection links opened their respective public Slax pages.
- The feed fit all four viewport widths in light, dark and e-ink modes. Desktop and phone screenshots were reviewed for headline readability, source attribution and first-screen density.
- Separate browser checks supplied cold-start, empty, network-failure and disabled-Lab responses. The page distinguished all four, retried a failed request, and omitted the recommendation request when the Lab was disabled.
- The deployed interface supplied the original member fields. The additive publisher and excerpt fields were exercised locally against the recommendation service and its real hydration query in PGlite. The public interface has not been deployed with these new fields.

## Automated checks

- The Web production build and Web and API type checks passed.
- The 47 focused Web tests covering Discover, Labs access and its settings and sidebar entry points passed. The page regression test covers member grouping, preview limits, the lead excerpt and single-member links. The updated page and its test passed ESLint.
- The recommendation service, HTTP controller, orchestrator, Workerd routing, Labs tests and architecture checks passed. The test of the 400-character excerpt also checked that a revoked member stays out of the response.
- API ESLint reported the existing unused parameter warning on the paused article feed. The modified files had no lint errors.
- `pnpm exec openspec validate --all --strict` passed all 153 items.

## Topic and member-ranking revision

The revised production Web build requested the Discover media type from the existing authenticated endpoint. The deployed service returned its original representation. The browser showed five topics from the returned titles. Six recommended Collections discussed AI coding. Switching topics changed the lead articles and rotating a topic changed the featured pair. Across the featured stories, remaining grid and singles, all 31 returned Collections and all 75 member destinations were present exactly once by Collection membership. The public article link opened from a topic feature. At widths of 320, 390, 768 and 1280 CSS pixels, the first featured Collection and its sibling links fit in the initial viewport in light, dark and e-ink.

The local service test exercised the real repository query in PGlite with controlled article vectors. An older relevant member outranked recent members, a duplicate URL appeared once, a saved article was excluded, and an article revoked during vector readback disappeared. Remaining unscored articles received the recent reason. Production per-article vector coverage and ranking quality have not been measured for this account.

## Independent ranking signals

A running local Chromium session exercised the built page with responses from the actual Discover HTTP controller, orchestrator, service and repository. The fixture used PGlite, three public member articles, controlled two-dimensional vectors and a stable Collection preference. With identical article affinities, the newer design article led despite being starred earlier. Changing its publication age made the five-day-old design article lead. Switching the viewer's saved-article profile to software made the software article lead. Removing the saved-article profile displayed the subscription-based reason. The focused service test also verified the Collection score stayed constant throughout. These are controlled causal checks, not production quality measurements.

## Whole-card ranking, deduplication and age discount

Replayed one completed beta impression using its 31 collection comparisons and 182 candidate records at the original scoring timestamp. Public beta metadata resolved for every candidate, and all original publication-age factors matched. The local service ranking function consumed the recorded member MMR picks, candidate relevance and reserve ordering. No export of raw user vectors was required.

The new order contained 31 Collections and 75 member links. Two representations of the same WeChat story shared an original title, source minute and word count. The winning card retained its copy and the lower card promoted its second member and filled its third slot from the same Collection's reserves. Comparing the same run with and without the additional age discount changed one card's members and did not change the first two cards. An expired forecast left the top three, while a historical technical comparison remained eligible.

Chromium ran the production Web build with this replay response at 1280px/light and 390px/dark. The page requested the Discover media type with limit 36. Both default headlines and all 75 member destinations were in backend order. Selecting a topic and returning to For You restored the default leads. Neither viewport overflowed horizontally.

The API and Web type checks, the production Web build, the 211 focused API tests, the 16 focused Web tests and strict validation of all 155 OpenSpec items passed. The API and Web lint checks reported zero errors. The local API exercises cover ordinary, Discover and authenticated diagnostic representations, late publication revocation, grouping and fills. This records a fixed-input replay of the proposed code, not a remote rollout of this revision or a measurement of reader engagement.

## Publication window and reading affinity

At the same November 18 beta impression timestamp, the previous whole-card replay displayed 75 stories across 31 Collections. Of those, 29 were at most 30 days old, 15 were more than a year old, and the oldest was 2,927 days old. Applying the new publication and card rules to the same 182 candidate rows, reranking relevance with the earlier source minute where available and using the recorded member-diversity choices displayed 55 stories across 23 Collections. Of those, 30 were at most 30 days old and the oldest was 174.4 days old. The six stories on the two default cards ranged from 0.9 to 13.9 days old. A WeChat lead captured around one day earlier carried a source timestamp 6.3 days before the impression. These ages use earlier, recognizable WeChat source dates when available and stored publication times otherwise. A fresh service request can admit different candidates because it applies the window before taking the twelve most recently starred members.

At 1280 × 900 and 390 × 900 in a Chromium session, the built Chinese Web page displayed both service-selected leads and all 55 article links in response order. Selecting a topic and returning to the default view restored both leads. Neither viewport overflowed horizontally. Screenshots show this fixed-input beta replay on the local build. All 219 focused API tests and API type checking passed, including a repository-backed service check where a recent capture has an old original article date.

## Source publication times

On November 18, 2026, an account replay reused the 18:01 Asia/Shanghai production exposure. It held the 40 Collection candidates, 148 eligible member rows, vectors and scoring clock fixed. The production watch-page fetcher retrieved the original timestamps from both affected curated videos. Both article extraction engines read the matching publication dates from five real Substack posts including custom publication domains. Of the ten source pages checked across this candidate set, nine dates required correction.

The original replay returned 32 cards and 71 articles. The corrected replay returned 31 cards and 69 articles. Both featured cards and all six of their article destinations stayed in the same order. The product and growth Collection moved from sixth to seventh. The two classic videos exceeded the 180-day window, removing their Collection from position 25. The one-article engineering interviews Collection moved from 31st to 30th. Chromium rendered both responses through the built Web page and verified the member links. These are fixed-input comparisons from the local service.

The historical data migration matches the primary key, URL digest and previously observed timestamp of each verified row. The read-only production check found nine matching rows. A local PostgreSQL-compatible run changed all nine, preserved the tenth verified timestamp and changed zero rows on a second execution. A changed URL also blocked the update. The service replay consumed these locally migrated timestamps. The 411 focused API tests, API type check, backend generation and strict OpenSpec validation passed.

Read-only production deployment and index checks traced the article marker separately. At capture, the production AI Worker used a publisher list containing three owners. The eight new curated owners were absent. All fifteen public article representatives existed, and none had the publisher marker. Their Collection vectors all had the independent Collection marker.

## Editorial front page on Web and Mobile

On November 18, 2026 Chromium exercised the built Web page against the account recommendation replay. At 1200, 768, 390 and 320 CSS pixels it retained the two expected lead links, stacked the covers on narrow screens and introduced no horizontal overflow. Light, dark and e-ink were exercised. Selecting a topic and returning to For You restored the backend leads. Chromium also opened the built library sidebar and followed New in Labs → Discover. The preview serves a recorded response and links to the public Collection and bookmark pages. The Web production build, type check and 33 focused tests passed.

On an iOS 27.1 simulator, XCTest activated the app, opened the library menu, tapped Discover and verified both the lead and a companion story on the native screen. The isolated fixture served two synthetic Collections through the normal mobile API client. A mounted regression also checked the request representation, backend link order and rejection of a late response from a replaced account. The Mobile check passed with 1,287 tests passing and five skipped. Android and iOS production JavaScript exports completed. Android device interaction was not exercised.

## Hands-on acceptance

On November 18, 2026, after the implemented Web preview and native iOS capture were shared, the change requester accepted layout B for the App and Web and authorized the pull request to dev. The requested design places the leading Collection in a solid editorial cover, stacks cards on phones, and groups the Web entry under New in Labs. No additional visual adjustments were requested at acceptance. The requester approved a Mobile patch increment to 1.0.33 (808), with previous build 807.
