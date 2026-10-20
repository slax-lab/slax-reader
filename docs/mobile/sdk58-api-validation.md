# SDK 58 real API validation

This was an HTTP integration check of the existing mobile `SlaxApi` and `SaveURLController` against `https://reader-api.slax.dev`; it did not use a device. Requests were restricted to that HTTPS host with redirects rejected. The bearer was held in the test process environment only; no credentials, claims, response content, or account details were recorded.

| Scenario | Result |
| --- | --- |
| Authenticated `GET /v1/user/userinfo` readiness | Passed (HTTP 200; boolean only) |
| Fresh synthetic URL preflight via `POST /v1/bookmark/exists` | Absent before each run |
| Save through the existing `SaveURLController` → `SlaxApi.addBookmarkUrl` path | Passed (one `POST /v1/bookmark/add_url` per invocation) |
| Redeliver the same invocation ID | Passed; no second save request |
| Read the created item via `/exists` and `/detail` | Passed |
| Request archive, then read the item again | Passed through the owner UUID route after bounded no-store detail reads; immediate reads could still report `inbox` |
| Delete only the current synthetic item and verify absence | Passed for all three confirmed test records |

Three synthetic records were created and confirmed deleted. The archive request returned HTTP 200. An immediate detail read remained `inbox`, while a bounded sequence of no-store reads (up to five reads, 300 ms apart) observed `archive`. This indicates a short read-after-write delay; only the owner UUID route was accepted after bounded polling. No unrelated records were listed, modified, or deleted.

This validates authenticated save, same-invocation deduplication, readback, archive state after bounded polling, and cleanup against the real API. It does not establish Duo simulator behavior, native App Intents, Siri, IAP, or store acceptance.
