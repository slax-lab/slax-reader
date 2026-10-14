# Design

## Context

See `proposal.md` - Why for motivation. Current state that shapes the approach:

- `systemPrompt` (`apps/api/src/const/prompt.ts`) is the single prompt behind both outline generation (`AigcService.generateOutline`, `apps/api/src/domain/aigc.ts`) and summary generation (`AigcService.bookmarkSummary`), and it currently ends with the JSON envelope instruction.
- The envelope only ever existed to feed the SDK structured-output schema that `7cf9c08` used and `292a4e9` removed; after `f70a665` the same prompt also sits behind `/v1/aigc/summaries`, which the web and extension panels call.
- Nothing in the API parses or validates the model's answer: `bookmarkSummary` writes model deltas straight to the response and `recordChunks` persists exactly those bytes; outline frames carry the accumulated buffer into `saveSummary`.
- A first attempt at this fix kept the prompt and added a tolerant extractor in `apps/api/src/utils/summaryContent.ts`, applied at two write sites and four read sites. The repository owner rejected that direction: it entrenches the wrapper and adds a layer instead of removing the instruction that created it.

## Goals / Non-Goals

**Goals:**

- Remove the envelope at its source, so the model answers with markdown and the API has nothing to wrap or unwrap.
- Keep the pipeline to one format, with no defensive normalization layer.
- Leave transport, access rules, and clients untouched.

**Non-Goals:**

- Migrating stored rows written under the JSON instruction.
- Adding a server-side parser, sanitizer, or fallback for model output.
- Changing the frontend's existing markdown handling or its filters.
- Aligning the `lang` a generation writes with the `lang` read paths look up.

## Decisions

**1. Fix the instruction, not the output.**
The wrapper is requested by the prompt, so the prompt is where it should disappear. Rejecting the alternative is deliberate: a server-side unwrapper (the first attempt) keeps the model emitting JSON, adds code on both the write and read paths, and has to guess at truncated envelopes mid-stream. Removing the instruction restores the behaviour the pre-change prompt produced and deletes an entire failure mode.

**2. No defensive normalization layer stays behind.**
One format in, one format out. If a model ever ignores the instruction and wraps its answer anyway, the frontend's existing markdown filter still strips envelope syntax for that response, and the regression is visible in the prompt test and in review — rather than being silently absorbed by code that every future reader has to reason about.

**3. Stored rows are left alone.**
Rows written while the JSON instruction was live keep their value; they are rewritten the next time that summary is generated (the panels generate when the cached read misses or the user forces a refresh). A one-off cleanup is a separate decision for the owner and is not smuggled into this change.

**4. Only the output-format block is removed from the prompt.**
The markdown requirements (syntax limited to `#`/`##`/`-`, anchors, language, nesting, excerpt rules) are what make the answer a mind-map outline; they stay byte-for-byte.

## Risks / Trade-offs

- [A model may still wrap its answer occasionally] → the frontend filter already copes with envelope syntax, and the next regeneration replaces the stored value; no server-side layer is added for this.
- [Existing rows keep showing the envelope until regenerated] → recorded as a non-goal with an explicit owner decision; the `lang` mismatch already keeps most cached reads from serving those rows.
- [The change is a prompt edit, so it is not provable by a unit test] → the prompt test pins the text (no JSON instruction, markdown-only syntax) and the definitive check is one live generation on the local stack.
- [Removing the block could change answer quality] → the removed text only described the response envelope; the content requirements are unchanged.

## Migration Plan

- Code-only change: edit the prompt, revert the envelope handling. No schema, data, or client coordination.
- Rollback is reverting the commit; rows written either way remain readable by the frontend's markdown filter.

## Open Questions

- Whether stored envelope rows should be cleaned up or regenerated in bulk - owner decision, no impact on this change.
- Why generation writes `lang = 'zh;q=0.9'` while every read path looks up `zh`, which makes the cached `/v1/aigc/summaries` branch and `GET /v1/bookmark/summaries` miss existing rows - separate defect.
- Whether the frontend's `extractMarkdownFromText` filter and raw fallback should be removed now that nothing wraps the payload - deferrable follow-up.
