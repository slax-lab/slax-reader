# Design

## Context

The existing helper already waits for Pages' final deployment status inside the serialized release job. Each existing `dev`, `beta`, and `main` Environment has `CF_ZONE_ID` and `CLOUDFLARE_API_TOKEN` Secrets. See proposal.md for motivation.

## Goals / Non-Goals

Keep the change in the existing deploy helper and workflow; do not add dependencies, a second release pipeline, browser cache changes, or automatic cloud configuration.

## Decisions

- Call `POST /zones/{zone_id}/purge_cache` immediately after successful deployment confirmation, using `{hosts: [hostname]}`. Whole-zone purge would affect other sites and is rejected.
- Validate the zone before any deployment side effects; inject both Secrets only into the guarded publication step. Use fixed branch-to-hostname mappings to prevent broad or arbitrary purge requests.
- Use a 15-second timeout, reject redirects, check HTTP and strict JSON success, and reuse the existing cleanup/failure path. Keep retries manual through the existing release rerun mechanism rather than adding a retry subsystem.
- Correct only the Web workflow's production Environment to `main`; API deployment is outside this request.

## Risks / Trade-offs

- Purge failure after successful deployment leaves the release live but the job failed; rerun the eligible release after correcting permissions or transient failures.
- API success is acceptance, not proof of eviction; rollout checks inspect an asset's version and cache headers.
- The earlier merged `web-pages-deployment` delta still names `prod`; this follow-up explicitly supersedes that mapping without editing another change's files.
