# Workflow cost investigation

Date: 2026-11-16. User-facing timezone: Asia/Shanghai. Access was read-only. No production retries, deletions, configuration changes, deployments, or notifications were performed.

## Observed sources and coverage

- Cloudflare account Workflows list, all 13 configured Workflows, current billing-period usage.
- Per-Workflow Metrics with the past-seven-days selector. Charts expose UTC daily buckets for November 10-16, including an incomplete final day. Totals below are dashboard snapshots, rounded where the dashboard rounds them, not final invoice line attribution.
- Production and beta Workers Observability, approximately 17:30-18:30 Asia/Shanghai, plus individual invocation logs and vector-maintenance input/step outputs.
- Billable Usage observed November 5-16: Workflow Steps approximately 1.32 million, 815.4 thousand billable, displayed cost USD 7.20; Workflow Storage displayed cost USD 0.80. Analytics and billing have different reporting boundaries and ingestion latency.
- Static checkout inspection of dispatch, queue acknowledgement, cron registration, media runners, and persistence contracts. Runtime stack/function names matched the account-cleanup source; exact deployed source equality was not established.

| Workflow | Seven-day steps observed |
| --- | ---: |
| vector-v5-maintenance-workflow | approximately 484,930 |
| vector-v5-maintenance-workflow-beta | approximately 337,480 |
| crawl-workflow | approximately 3,280 |
| content-validation-workflow | approximately 1,850 |
| podcast-workflow | 118 |
| youtube-article-workflow | 23 |

The remaining workflows were inspected at account-list level, not individually attributed by step totals. Beta crawl/content validation had small retained instance counts, beta media had no recently retained completed instances, and import/legacy ASR showed no recent execution. These observations are not a claim of zero historical billing. The account list did not show a second persistent backlog comparable to vector maintenance.

## Confirmed recurring producer

Both production and beta emit `User deletion recovery failed` on their five-minute scheduled invocation. Sampled failures concern the same deleted users and end in `UserDeletionService.deleteUserBookmarks`. New vector instances in matching batches target the same account's article and two preference kinds. One completed Collection-preference cleanup returned `state: empty`, no vector or mutation IDs, and reason `collection_preference_on_demand`, but still executed two steps.

The code dispatches vector cleanup before database cleanup; the cron writes its completion marker only after the whole cleanup resolves. Failed runs therefore create new UUID-based Workflow instances again on the next scan. A second application-driven replay path exists in the initial queue consumer, which rethrows a failure before acknowledgement. Its actual redelivery count was not measured.

Even successful accounts can return to the scan: success markers have a 31-day TTL while deleted-account enumeration has no corresponding terminal exclusion. This is a direct code-path risk, not an observed 31-day recurrence in this incident.

The likely database blocker is dependent bookmark-tag rows: cleanup deletes user bookmarks before bookmark tags while the schema defines a foreign-key relation. Runtime logs did not preserve the database error code or constraint name, so the exact database cause remains unconfirmed. A configured read-only PostgreSQL query was unavailable because the local connection returned `Operation not permitted`; the investigation relied on actual Workers/Workflow logs instead.

## Other cost amplification paths

1. **Independent dispatches are billable even when business state is idempotent.** Vector enqueue generates a new UUID on every call; batch deduplication only covers the current call. Repeated refresh/mutation requests can create separate Workflows for one target. Normal article work has article write/visibility, preference write, and per-output visibility steps. This is a potential amplifier; broad normal-operation duplicate frequency was not measured. Sync star updates already skip unchanged state, so this is not a claim that every sync upload causes work.
2. **Media total spend has no application budget admission gate.** YouTube and podcast daily cost functions increment counters but do not reject new work based on those counters. Per-row attempts are bounded at three and concurrent generation is limited, but those bounds do not cap daily distinct-source admissions or external-provider costs. Currently observed Workflow steps are small.
3. **Podcast polling uses separate sleep and poll steps.** Delays grow from 30 seconds to one and two minutes with a two-hour accumulated-sleep bound: up to approximately 66 polls and 66 sleeps in one full pending transcription attempt, before other work. The loop is bounded, not infinite. Increasing volume still increases step count; external ASR and LLM charges are separate from Cloudflare steps.
4. **Retained Workflow state incurs storage charges.** The dashboard retains success/error state for 30 days. Article maintenance can persist a previous numeric vector in a durable result; operator refresh can also carry accepted outputs/previous vectors in input. Continued creation multiplies retained state. Shortening retention is a separate optional operational change with a debugging-history trade-off, not part of stopping cleanup retries.
5. **Capture rescue can admit duplicate instances before claim.** The minute-level detector selects up to 100 pending rows within a 24-hour creation window. Creation uses an automatically assigned instance ID, while the durable claim happens inside the Workflow. An unclaimed pending row can be selected again. The existing atomic claim prevents duplicate content writes, but does not eliminate already-created invocation/claim-step cost. Current observed crawl volume is small; no second runaway was established.

## Pricing interpretation

Cloudflare bills steps, storage, CPU, and invocations separately. Step retries themselves are excluded from step count; a fresh Workflow instance or an explicit new step is different. Sleeping does not consume CPU, but sleeping operations can contribute to billable step usage. Completed instance retention can continue storage billing without any new execution.

Official references:
- https://developers.cloudflare.com/workflows/reference/pricing/
- https://developers.cloudflare.com/changelog/post/2026-07-07-workflows-billing-updates/
- https://developers.cloudflare.com/workflows/build/sleeping-and-retrying/

## Intervention and verification status

The implementation removes only application-driven account-cleanup replay: delete the recovery cron and consume/log handled initial cleanup failures. Existing finite native Workflow retries are unchanged. It does not cancel in-flight work, alter unrelated schedules, configure spending thresholds, repair residual records, or deploy.

Planning validation passed before implementation. Current implementation checks, the isolated Workerd exercise, and verification gaps are recorded in [validation.md](validation.md). No production cleanup was replayed for verification.

## Shared beta and production resources

A follow-up read-only dashboard check confirmed the beta AI Worker and production AI Worker bind the same three production V5 indexes, while preference Durable Object namespaces belong to their respective Core Workers. The duplicate deleted-account scan therefore performs cleanup against the same authoritative data and indexes from both environments. Ordinary events are dispatched by the environment receiving the request; there is no evidence every ordinary save automatically dispatches to both Workflows. Removing the recovery producer in both builds stops the observed double processing without breaking beta live maintenance.
