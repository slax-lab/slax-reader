# Validation

## Scope and environment

Implementation and review took place on 2026-11-04 on `fix/recover-snapshot-expired-session`, based on `origin/dev`, in an isolated worktree. Only Web implementation, Web test fixtures/tests, and this OpenSpec change are included. No production account, real session token, secret file, database mutation, or deployed service was used. Web/API version increments do not apply under `docs/release/VERSIONING.md`; Extension, CLI, and Mobile package output is unaffected.

Local commands use the documented development placeholders: Web origin `http://localhost:3217`, API placeholder `http://localhost:8787`, cookie name `slax_test`, cookie domain `localhost`, synthetic Google client ID, and empty optional Apple/Turnstile settings.

## Automated checks

- `pnpm install --frozen-lockfile --offline`: passed; existing pinned dependencies installed without changing the lockfile.
- Loader regression red phase: 401 and 403 tests failed with actual 500, while 404, server/transport failures, and authorized body selection passed. The new recovery tests also demonstrated missing cleanup/reload before implementation.
- `pnpm web -- test`: passed, 226 files passed and one skipped; 2,586 tests passed and three skipped. Happy DOM printed an AbortError during fetch teardown without a failed test or nonzero exit; the same teardown message appeared in the earlier full-suite run.
- `pnpm web -- typecheck`: passed.
- Changed-file ESLint: passed for all changed implementation, fixture, and test files.
- Whole-Web ESLint: fails on 97 existing import-sort errors in 97 unchanged files. Each failing file was also linted from its `HEAD` content via ESLint `lintText`; the same files have 97 baseline errors and no added errors. Unrelated files were not reformatted.
- `pnpm exec openspec validate --all --strict`: passed, 100 items, zero failures.
- `git diff --check`: passed.
- `pnpm web -- build`: passed with the documented development placeholders; client, SSR, and Cloudflare Pages output generated successfully. This is not a production-configuration deployment check.

## Running-browser exercise

Started the real Nuxt application with the opt-in test layer:

```sh
pnpm web -- dev --port 3217 --extends ./tests/fixtures/session-recovery
node apps/web/tests/fixtures/session-recovery/browser-check.mjs http://localhost:3217
```

The layer supplies only synthetic BACKEND/OSS bindings for named fixture snapshots. The production content loader, SSR page, hydration, route middleware, cookie cleanup, account-generation handling, and PowerSync plugin remain real. Browser API stubs supply harmless responses to unrelated endpoints; PowerSync's local JWT expiry check is exercised with a decodable synthetic `exp: 1` token. The harness waits for complete hydration and idle before injecting credentials for client-navigation scenarios. Development reloads during source/prepare changes were excluded by rerunning against a stable server.

All 13 browser scenarios passed:

1. Direct entry with host-only rejected cookie: one recovery reload, cookie removed, public content readable, complete URL retained.
2. Direct entry with explicit-domain rejected cookie: same result.
3. Direct entry with coexisting supported cookie variants: same result; unrelated cookie retained.
4. Client navigation with host-only rejected cookie: same result.
5. Client navigation with explicit-domain rejected cookie: same result.
6. Client navigation with coexisting variants: same result.
7. Cookie deletion intentionally blocked: one document only, cookie remains, existing error text stays visible, no blank page and no reload loop.
8. Expired decodable JWT while navigating from a mounted snapshot to a public snapshot: complete destination path/query/fragment retained, cookie removed, public content readable.
9. Same navigation to a private snapshot: complete destination URL retained, cookie removed, one recovery reload to 404, no private body.
10. Direct private snapshot entry with rejected cookie: one recovery reload to 404, no private body.
11. Anonymous 401: zero recovery reloads and no cookie cleanup.
12. Metadata 403: zero recovery reloads, cookie retained.
13. Service 503: existing Web service error 500, zero recovery reloads, cookie retained.

Direct cookie-rejected SSR also returned 401 with `Cache-Control: private, no-store`, a recovery shell, no article body, and no raw synthetic token in its HTML. Existing cache-isolation/PDF tests passed as part of the full suite, including invalid credentials bypassing shared HTML, anonymous authorization revalidation, and no body reads for rejected metadata.

Screenshots are local temporary artifacts, never committed. The pending recovery shell was exercised with Light, Dark, and E-ink at 320px, 768px, and 1200px (800px height): all nine combinations displayed the existing localized loading text through its `role=status` live region with no horizontal overflow. Screenshots at narrow Dark and E-ink were visually inspected; no layout or readability regression was observed. The test temporarily held the browser idle callback to make this short-lived state inspectable; normal automatic recovery was separately exercised without that hold.

No new controls, icons, layout rules, or theme tokens were introduced. The existing failed-cleanup presentation was also inspected at desktop Light; its copy remained visible rather than a blank page. Screenshots are under `/tmp/slax-snapshot-session-recovery/` for optional attachment. A desktop Light recording of the real recovery transition is being prepared for the PR, without committing media.

For human acceptance the fixture server uses its own same-origin `/v1/share/mark_list` fixture (`DWEB_API_BASE_URL=http://localhost:3217`) so the final guest article can initialize without an external API. The opt-in layer is not part of normal builds; the built JavaScript was checked for its fixture markers and none were present.

## Review and fixes

An independent reviewer performed Bugs, Security, and Compliance passes and reproduced integration defects that isolated helper tests did not catch. The following were fixed and independently re-exercised:

- Default-layout token refresh redirected before the page could recover: the established SSR recovery marker now prevents competing initialization.
- Account cleanup erased the original content error and left a blank page when cookie deletion failed: the page preserves that error during recovery.
- PowerSync expiry handling could redirect to login or reload a source snapshot before destination navigation finished: the navigation marker now defers sync side effects until the destination metadata decides; a mounted snapshot owns revalidation and recovery.
- Shared recovery ownership is tied to a Vue component ID so disposal of an old healthy snapshot cannot clear a newer recovery.

Final independent browser review found no remaining Important Bugs or Security findings: expired-JWT navigation to public and private destinations kept the complete target URL, removed the cookie, reloaded once, and produced no pageerror. The final Compliance pass must also confirm the completed evidence and pre-PR human acceptance.

## Verification limits

The harness does not verify production deployment, a real signed JWT's signature/expiry checks in Core, real login/PowerSync connectivity, account database changes, or all article formats. No backend authentication, PDF delivery, schema, or API contract was changed. Rejected metadata behavior is verified using synthetic upstream statuses and the actual Web runtime; connector expiry parsing uses a synthetic decodable expired token. These are declared agent-executable integration gaps, not claims of production verification.

## Human hands-on acceptance

Pending. The user approved the proposal and requested review/PR delivery, but has not yet exercised the implemented recovery. Before opening the PR, record the accepting person, date, scenarios exercised, and any requested adjustments under `DESIGN.md` section 10.2. Proposal approval does not substitute for this checkpoint.
