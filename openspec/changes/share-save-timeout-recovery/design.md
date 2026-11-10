# Design

## Context

PR #509 introduced bounded share recovery but unnecessarily added a new receipt API. The owner explicitly instructed removing it and querying the existing `/v1/bookmark/exists` endpoint without changing its semantics.

## Decisions

### Client-only timeout recovery

Keep the current sequence: create with a five-second total deadline; success/error normally; ambiguous create timeout triggers one existence request with a three-second total deadline. Use the same captured API origin and authorization and the original extracted URL in `{target_url}`. Do not send the title or retry creation.

The existence response is ordinary JSON. Require HTTP 200 and `data.exists` of boolean type with value true. Do not accept string/number coercions, an arbitrary successful status, a nonzero bookmark ID, or a partial response body. Treat false, missing/malformed data, rejected status, transport error, and incomplete body at the deadline as unconfirmed and display the existing timeout message.

### Body consumption stays inside the lookup budget

The iOS request owner must distinguish create success (finish at delivered 200/204 headers) from existence lookup (consume the JSON body before deciding). The three-second deadline covers the complete lookup transport, and a body timeout must remain failure even when partial bytes resemble a valid JSON document. Android keeps its existing total OkHttp call deadline active while reading the lookup body. Neither client restarts the deadline when bytes arrive.

Keep existing cancellation guards, explicit creation-error handling, and original create diagnostic evidence. The lookup must not overwrite original create metrics or create a second terminal diagnostic.

### Restore the backend to its existing contract

Remove all new receipt HTTP/domain/repository methods, URL-resolver cancellation changes, and receipt-specific API tests from #509. Regenerate registration with `pnpm api -- gen:all`; do not hand-edit generated routes. Verify the affected API tree equals its pre-#509 baseline, because no unrelated API changes landed on the corrective branch base.

Do not modify `/exists` URL handling, deletion behavior, Reader-fork readiness, authentication, or response shape. Existing semantics are the explicitly requested source of truth; do not compensate for them in the clients.

## Verification and Delivery

Update the existing Swift/Kotlin HTTP host fixtures to return the real existence envelope. Test boolean true/false, missing/malformed/string/number values, non-200 status, partial/stalled body, same origin/auth/URL, one lookup only, and cancellation. Run the relevant host/unit tests and the standard dual-platform bundle. No native builds, devices, full runtime environment, or manual UI acceptance are required by the owner.

Keep `1.0.28 (800)` / previous `799` and regenerate the authoritative iOS source copies through the existing plugin. The original PR is merged, so deliver a corrective PR from `fix/share-recovery-use-exists` and sequence archiving of this capability after the correction. No API-before-client deployment dependency remains: clients use the already existing endpoint.

## Trade-offs

Existence lookup may itself time out, or return false under its existing URL/parse/deletion semantics. In either case display the requested timeout outcome; do not introduce new server behavior to address those cases. A positive lookup means the existing endpoint reports existence, not proof this invocation created the bookmark.
