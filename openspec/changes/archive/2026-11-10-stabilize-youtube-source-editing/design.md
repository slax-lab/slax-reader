## Design

The user approved direct source-to-target generation, per-passage acceptance and repair, resumable progress, and local heading/introduction fallbacks on November 6, 2026. Apply this directly to the v2 runner.

Keep program-owned passages, cue references, speaker attribution and seek times. Batch passages inside the existing bounded chunk concurrency. Translate foreign-language captions directly. Same-language editing is optional and falls back to cleaned source wording. Headings fall back to an extract of accepted text. Introduction generation is optional and falls back to accepted body excerpts.

## Acceptance and recovery

Persist accepted passage text independently of rejected results. Validate target language with allowances for short names and terms, normalized explicit numbers, source-relative length and duplicate output. Record rejection reasons and previous output for targeted repair. Source-aware passage checks decide content acceptance in the final assembly too; whole-article metrics remain diagnostic. Existing structural checks still gate publication. Neither structural nor heuristic checks prove semantic translation fidelity.

Each workflow run permits one initial response, one repair batch and one single-passage repair per leaf. A truncated batch is divided, and a truncated single passage may split at sentence boundaries to depth two. Child results persist and join in source order under the parent's cue references. Transport failures leave accepted progress intact and use the existing workflow backoff. Per-run content attempt limits, request admission, run/lifetime spend limits and leases bound work. A subsequent run retains accepted results and gets a bounded repair allowance for unresolved passages.

Estimate remaining cost from unresolved passage leaves. Successful original-language text needs no mandatory model spend. If request admission rejects optional same-language editing for insufficient run or lifetime budget, retain accepted edits and use cleaned source wording for outstanding passages. Optional headings and introductions likewise fall back without further model spend. Required translation that remains unaccepted stops on exhausted budget. Lease loss, storage and accounting failures still stop publication, including an actual spend overrun detected during accounting.

Assembly reports localizable content failures by passage. A separate durable repair step invalidates only those results and rewrites their chunk; assembly is repeated once. Unlocalizable or exhausted errors retain progress and stop with an error. Successful publication and takedown retain their existing cleanup.

## Scope

Use existing workflow parameters, storage prefixes, output schema, rendering and access controls. No new model provider, compatibility selector, deployment or production retry. Validate with fault injection and live Gemini replay.
