# Design

## Context

See proposal.md for the two observed incidents and the approved scope. The current YouTube runner combines paragraph translation, heuristic acceptance, introduction generation and search indexing in the delivery path. The podcast runner shares its model interface and cost estimator. Existing canonical identities, body eligibility, lease ownership and spend admission remain authoritative.

## Goals / Non-Goals

Deliver every structurally complete source-owned translation without requiring an inferred numeric or length match. Recover only missing work, preserve completed units and keep delivery independent of optional enrichment and indexing. Replace text generation in both media article workflows with DeepSeek. No application-wide provider switch, client API change, UI redesign, database migration, alternate provider or compatibility selector is introduced.

## Decisions

1. Use one DeepSeek client for all media article text generation. The model is fixed to `deepseek-flash`; the API base is fixed to `https://api.deepseek.com`. The operator supplies `DEEPSEEK_API_KEY`. Use non-thinking JSON output with explicit JSON instructions, bounded output, caller cancellation and no provider fallback. Preserve usage and finish reason before accepting content. Treat empty, malformed and truncated responses as recoverable content failures. Errors carry status and safe codes, never response text or credentials. Use Workers-supported manual redirect handling and reject non-success responses without forwarding credentials. Exercise the real Workerd fetch implementation in regression tests; Node-only protocol tests cannot establish Workers compatibility.
2. Source captions determine paragraph identity, order, speaker and time references. A model supplies text and optional headings, not the source map. Original-language text remains usable when optional editing fails. Numeric and length checks remain diagnostics; empty text, missing units, obvious refusal and unusable target language remain blocking. This avoids endlessly asking a model to satisfy a heuristic that cannot resolve ambiguous speech.
3. Store successful passage results as soon as a response is accepted. Retry only incomplete passages with smaller groups and bounded subdivision. Keep successful siblings even if another fails. Run chunks through bounded rolling concurrency and collect failures after independent chunks finish. A chunk invocation makes at most 16 content requests, with at most three content attempts per leaf and two subdivision levels. Existing workflow attempts, time limits and cost admission bound recovery; permanent provider outages cannot guarantee a translation.
4. Render a complete base article with deterministic heading and introduction fallbacks. Optional model wording must not invalidate accepted body passages. Read immutable inputs and independent chunk objects concurrently where safe; do not serialize unrelated storage calls.
5. Publish the canonical article and eligible bookmark bodies before a separate durable search-indexing step. Preserve access, moderation, marks and current revision checks. Index and cleanup failures must never demote an already ready article. A pending-publication record in R2 is written before deferred body publication and removed after indexing succeeds; the existing sweep retries retained records without restarting generation. Return the business outcome from the workflow so orchestration completion is not mistaken for successful generation.
6. Provider cost accounting must follow the selected model, including conservative reservation when usage is unavailable. Do not silently reuse Gemini prices as measured DeepSeek spend. Existing budget caps remain in place.

## Risks / Trade-offs

- Semantic translation fidelity cannot be proven by counts. Preserve source references and diagnostic differences; verify both incident videos with the real provider.
- Provider outage or invalid configuration can still prevent new translations. Preserve completed work and explicit failure/retry status; never publish original-language text as a successful translation.
- Moving indexing after body publication permits a temporary search lag. Durable retries and revision checks prevent indexing from blocking reading or overwriting newer content.
- Credential-free checks cannot establish provider latency or quality. Actual provider runs remain pending until the operator supplies the key.

## Migration Plan

No schema migration. API and Web do not use package-version increments; no CLI, Extension or Mobile contracts or package outputs change. Deploy only after local verification and review, with the DeepSeek key configured by the operator. Existing prompt-version metadata identifies stored artifacts but does not select a legacy generation path. Rollback uses the previous deployment; do not add a runtime provider fallback. Reconcile the merged source-editing delta before or with archiving this change.
