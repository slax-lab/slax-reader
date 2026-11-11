

## PR #572 security review follow-up

The first automated review of the original implementation found an Important privacy defect: quoted detail spanning a newline could bypass redaction. Rather than expanding the regex, the final implementation **does not log arbitrary provider detail at all**. It retains the structured provider code and only static safe labels for `INPUT_TOKEN_LIMIT_EXCEEDED`, `INVALID_TASK` and `AUTH_INVALID_API_KEY`. Unknown codes retain no provider detail. Structured detail objects are ignored rather than serialized. The request ID header fallback now applies even when a detail label exists.

Regression tests cover multi-line article excerpts, structured detail arrays, arbitrary provider details and header fallback. All 30 focused tests and all 3,904 full-suite tests passed after the change. Typecheck, lint, strict specs and four Worker builds also passed. The earlier Important finding is addressed without retaining any potentially sensitive provider text; no Important finding remains. No deployment or replay occurred.

Remaining non-blocking observations: provider detail shapes are intentionally ignored rather than transformed; the PR-only design is explicit. The existing cron-context warning belongs to the earlier collection work, not this diff.
