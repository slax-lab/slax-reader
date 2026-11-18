# Design

## Context

The authenticated Collection endpoint computes a preference from the reader's eligible subscriptions. It recalls candidates from the Collection vector index, checks current visibility and returns ranked Collections with up to three readable member previews each.

## Goals / Non-Goals

The Web client owns presentation, Labs access and navigation. The existing recommendation service owns the eligibility and ordering of Collections. The independent article feed has its own publication policy.

## Decisions

- Read the account's Lab setting before issuing the normal `GET /v1/recommendations/collections`. The existing endpoint continues to serve its other clients.
- Request up to 36 Collections. Web asks for the Discover representation with `Accept: application/vnd.slax.discovery+json`. Ordinary clients still receive up to three recent public members per Collection. A server that returns the original JSON representation remains usable by the Lab.
- In the Discover representation, consider the 12 most recently starred eligible members published within the last 180 days in each candidate Collection, excluding the viewer's own saves and saved URLs. Use native Collection recall and Collection-level MMR. For the bounded pool of up to 50 eligible Collections, read the existing owner-specific article representatives by exact identity, then recheck publication and subscription eligibility before rendering picks.
- Read the viewer's existing saved-article preference once per Discover request after Collection selection. The underlying profile weights a save once and a current star once more. Rank eligible member representatives against that profile, falling back to the Collection preference when the saved-article profile is unavailable. Label the two evidence sources separately.
- Weight a positive member cosine by `0.90 + 0.10 × exp(−0.015 × publication age in hours)` before duplicate removal and MMR. The starting timestamp is the stored bookmark publication time, which some ingestion paths initialize to capture time. YouTube capture reads the canonical watch page publication metadata. Substack capture reads the matching article from the original JSON-LD before content cleanup, including on custom publication domains. Before member scoring, an exact original minute from a WeChat article excerpt can move this time earlier. Interpret that specific source format in China Standard Time and check the age limit again. A single request timestamp anchors the inclusive age window for both member reads. Missing or future publication times are ineligible. Fill unused positions only with distinct members published in the last 30 days whose vectors were unavailable. A measured nonpositive match is ineligible.
- The design draws on explicit subscription signals and publication-time decay in [Brave News](https://github.com/brave/brave-core/blob/e2cdf58b0bf08b3b234e3def72cc8ce7d47489f5/components/brave_news/browser/feed_generation_info.cc) and the candidate-age decay in [ZoRRO](https://github.com/johanneskruse/zorro/blob/c84c25b73845c026e52e83a134e63cdd982a5750/src/zorro/model/zorro_numpy.py). The existing Slax decay rate corresponds to an approximately 46-hour half-life. The 10% maximum discount is an initial Lab parameter for mixed-age reading material and needs evaluation against Slax outcomes.
- For topics, match the returned titles against a bounded bilingual vocabulary. A topic requires distinct article URLs in at least two multi-member Collections. Show up to five topics by the number of matching Collections. Each selection features one topical story and up to two sibling articles from each of two Collections. Retain the service order among matching ranked members. For legacy responses, prefer fully titled stories over automatic social-post titles. Cycling advances to the next pair within the topic.
- The remainder of the response appears once in a scrollable Collection grid, followed by single-member picks. Within each of these sections, preserve the service's Collection order. The default spotlights remain available when no topic qualifies.
- Project the site name and up to 400 characters of the stored description in the existing member hydration query. Both fields are optional to Web so the page also works with the deployed response.
- Use the existing public Collection and bookmark routes. Account replay uses saved beta rank evidence and public member metadata at a fixed scoring time.

## Default card ordering

Use the first two server-ordered multi-story cards and the first member of each as the default spotlights. Topic matching takes effect only after a reader chooses a topic. Returning to For You restores the same server order.

After member MMR, retain its three picks followed by the remaining scored candidates and recent fallback candidates. At each selection, remove already placed stories and rank the actual remaining cards by the sum of their Collection-affinity rank and reading rank. The reading score weights the lead twice and the strongest visible companion once. Within each format, place cards with positive reading matches first. Break a joint rank tie by reading score, then Collection MMR order. Fill multi-story cards before singles. Remove empty cards before applying the requested limit.

Match canonical URLs after removing tracking parameters and document anchors, retaining hash routes and content-defining query parameters. WeChat short/long aliases can also match on exact original title, an extracted source timestamp precise to the minute and identical word count of at least 100. Article aliases and equal titles alone do not establish identity.

The initial publication-age multiplier remains bounded at 0.9–1. For ordinary stories, an additional presentation discount grows linearly from zero at 30 days to 20% at 180 days. Use the larger of this discount and the title-specific discount. The title-specific discount is 30% for a forecast explicitly referring to an elapsed year. A dated release announcement has a seven-day grace period followed by an exponential discount approaching 20%, with a 30-day time constant. The presentation pass moves a member down by the discount times the 12-member window and discounts its card contribution by the same fraction. Historical reviews and tutorials retain the ordinary publication-age treatment. The same age and interest rules govern leads, companions and reserves.

## Recommendation metadata

Collection recall requires the existing Collection index metadata flag. Article representatives owned by configured publishers carry their own recommendable metadata. Grouped Discover reads exact, currently public members from the recalled Collections and scores their vectors against the reader. The article publication marker supplies no personal-affinity score.

## Risks / Trade-offs

Available member counts vary with the reader and current publication status. Display the actual counts. Readers without a usable preference see the subscription guidance and a link to their Collections.

## Editorial presentation

The selected B layout uses a solid leading card, a ruled secondary lead, and compact companion links. Keep topic exploration available on Web as a secondary control. Mobile uses a native stack screen and virtualized list with the first card emphasized, reads the same representation through the credential-aware API client and opens public reader links for recommended material outside the local library. Only Web entry is opt-in through Labs.

Each Collection masthead pairs its public name with a typographic bookplate and a localized Collection label. Each link below it identifies the article's publisher using its site name or URL hostname. This distinction applies to companion stories as well as the lead and preserves service order.
