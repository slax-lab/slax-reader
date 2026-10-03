# Design

## Context

The Core worker's HTTP entry is `apps/api/src/entry/core/index.ts`. Registration comes from the generated `apps/api/src/di/generated/readerRouter.ts`, whose `getRouter(container)` wires the shared middleware (`cors`, `auth`, `requestLog`, `rateLimit`) and every controller route, and returns a router regardless of the request Host.

On dev, a hand-written wrapper `apps/api/src/di/router.ts` sat between them. It returned the generated router only for an exact Host match against the operator's `BACKEND_API_PREFIX` origin (HTTP(S) protocol, no embedded credentials) or one of eight legacy hosts (`reader.local:8787`, `localhost:8686`, `localhost:8787`, `reader-api.slax.dev`, `reader-api.slax.com`, `apix.reader.slax.app`, `api-reader.slax.com`, `api-reader-beta.slax.com`), and `null` for anything else. The entry then answered `Failed('host not found')`.

The RSS work deleted that wrapper, rewired the entry to the generated router, and removed the regression case that pinned the rejection behavior. The deletion is not required by anything in the RSS feature, so there is no in-band rationale for it in this repository's history.

## Goals / Non-Goals

Keep the routing deletion together with the artifacts that describe it, so the removal of the Host allow-list is reviewed as its own change rather than as an unexplained hunk inside the RSS change. Restore the same files on the RSS change so that change carries only RSS.

Not in scope: adding a replacement guard, changing Cloudflare route patterns or deployment topology, changing the deploy-time `BACKEND_API_PREFIX` requirements, and any RSS behavior.

## Decisions

- **Registration path.** The generated router becomes the single registration path: the entry calls `getRouter(currentContainer)` and no longer interposes a per-host wrapper. This is the only part of the deletion that is a straightforward simplification — the wrapper's only other contribution was the Host decision.
- **The Host decision.** The allow-list is dropped rather than relocated. This deletion arrived without a stated reason, and the isolation of this change is deliberately not used to invent one: review should either accept a Core worker that serves any Host that reaches it, or require the exact-match check to be reinstated (in the entry, or inside the generated pipeline so the wrapper's duplication does not return). The delta spec states the accepted behavior as the current one so the decision is visible in the specs rather than implied by missing code.
- **Configuration stays.** `BACKEND_API_PREFIX` remains a required operator value at deploy time (`apps/api/script/deploy/config.ts` requires it for HTTP host routing and requires a real HTTPS origin for remote deployment). Removing its runtime consumer does not remove the configuration requirement; this change does not touch the tooling.
- **Artifact consistency.** `openspec/changes/api-command-proxy/design.md` states that the API accepts the explicit `BACKEND_API_PREFIX` Host and keeps legacy Host compatibility. That statement describes the deleted wrapper, so it is corrected here, in the same change that makes the code contradict it.

## Risks / Trade-offs

- **No runtime guard remains.** After this change, a request that reaches the Core worker under any Host is authenticated and routed like any other. The `reader.example.com.attacker.test` and `reader.example.com:8443` spoofing cases the removed test pinned are no longer rejected, and nothing pins them.
- **What still protects Core.** Cloudflare route patterns decide which hostnames reach the worker at all, and the documented topology keeps Edge as the only public HTTP entry. A `workers.dev` route or an overly broad route pattern would expose the Core API under arbitrary hostnames — the case the allow-list used to absorb inside the worker.
- **History.** The deletion carrying no rationale is itself a signal the reviewers should weigh: nothing in the RSS change, the RSS artifacts, or the surrounding code explains why the control had to go.
- **Rollback.** Reinstating the control means restoring the three files as they are on dev (`fix(api): restore the Core host allow-list` on the RSS branch shows the exact diff); no schema, contract, or data migration is involved.
