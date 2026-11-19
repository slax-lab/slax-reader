## Running verification

On 2026-11-17, replayed two real collector captures against isolated local Edge and Core Workers, migrated PostgreSQL and D1, and local R2. Seeded already-successful private bookmarks with their stored HTML and a starred relation with an owner alias. Submitted attributed HTML through authenticated `POST /v1/bookmark/add`, then read the owner detail, anonymous Collection list through ContentEntry, and anonymous Collection detail.

| Capture | Before | After resubmission |
| --- | --- | --- |
| Signed WeChat engineering article | Populated title, empty site and byline | Original title, WeChat platform name and the signed author |
| Independent blog post | Empty title, site and byline | Original article title, publication domain and source author |

Both replays returned the existing bookmark ID, and the public list contained the same single starred relation for each article. Owner detail retained the star and relation UUID. Public detail retained the original target URL, UUID and alias. A conflicting submitted WeChat title left the stored title intact. A partial blog submission initially filled only the byline; a subsequent complete submission filled the remaining blanks. Both public HTML bodies exactly matched their R2 inputs across replays. The ordinary structured WeChat path was also exercised separately with the real article fragment through HtmlBuilder and ContentParser: it returned the signed author, platform name, original title and 6,837 characters of article text.

## Automated checks

- Full API suite with workspace-local dependencies: 4,308 passed, 158 conditionally skipped, zero failed.
- Focused API tests: cached/private saves, ordinary WeChat parsing, crawl workflow and architecture (187 passed).
- API and contract type checks; API generation with the tracked example configuration (no generated drift).
- ESLint on the changed API implementation: no errors.
- `openspec validate --all --strict`: 148 items passed.

## Rollout

Beta and production were not modified. After promotion, verify the two distinct missing-field cases against beta before replaying uniquely matched historical records. This change has no client, schema, cron or publisher configuration changes.
