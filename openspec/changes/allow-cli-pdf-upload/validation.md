# Verification

On 2026-11-18 the hotfix was exercised on the main-branch baseline with a disposable PostgreSQL 17 database, local D1 and R2, and the repository's Wrangler Edge and Core HTTP smoke setup. A temporary test account received a fixture API key. Requests used the actual Edge authentication, Core PDF upload handler and local storage. The CLI version was kept at the operator's request.

| Request | Observed result |
| --- | --- |
| POST a valid PDF with an unknown key | API key not found |
| GET the upload path or POST a child path with the fixture key | API key route denied |
| POST a valid PDF with PDF Labs disabled | PDF Labs opt-in required |
| POST invalid bytes after enabling PDF Labs | Invalid parameter. The database contained zero uploaded PDF bookmarks after the rejected requests. |
| POST a valid PDF with an embedded title | HTTP 200 and a bookmark receipt. A database lookup using the returned bookmark UID found the fixture user's bookmark titled “Isolated CLI PDF”. |

The three Vitest suites for CLI route admission, PDF bookmark persistence and API key issuance passed (60 tests). Route coverage includes the trailing slash, a child path, a sibling name and non-POST methods. The full strict OpenSpec check on the main baseline passed (147 items). The local pre-push review checked the method/path match, continued key verification and PDF opt-in, test coverage, and correspondence with the approved change.
