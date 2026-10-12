# Ask the model for markdown directly instead of a JSON envelope

## Why

The outline/summary prompt requires the model to answer with a JSON envelope:

```
## 输出的格式如下，注意为JSON格式
{
  content: "上述markdown格式的总结内容"
}
```

That instruction was added in the internal fork (`7cf9c08`, #586 "add outline api") because that endpoint used the SDK's structured output: the model emitted the envelope, a zod schema parsed it, and the server returned `result.object.content` — so clients only ever saw markdown. `292a4e9` (#596) switched outline generation to a raw stream and dropped the schema, and `f70a665` (#860) merged the open-source `/v1/aigc/summaries` implementation — the endpoint the web and extension panels actually call — onto the same prompt. Nothing unwraps the envelope any more, so the API streams a JSON document to the frontend and stores it verbatim in `sr_bookmark_summary.content`.

The reference behaviour is the prompt from before that instruction existed: the open-source base (`slax-reader-api` at the commit the internal repository pinned) asks for a markdown list and nothing else, so the model answers with markdown and the endpoint forwards markdown. This change restores that: no envelope on the way in, therefore none on the way out.

## What Changes

- Remove the JSON output block from `systemPrompt` in `apps/api/src/const/prompt.ts`, so the model is asked for markdown directly, exactly as before the fork added the envelope. Every other requirement of that prompt (markdown-only syntax, anchor format, language, nesting) is untouched.
- Drop the server-side envelope handling introduced in the first attempt at this fix (`apps/api/src/utils/summaryContent.ts` and its call sites): with no envelope requested, the API forwards and stores the model's output unchanged. One format in the pipeline, no wrapper and no unwrapper.
- Keep every transport and access contract as it is: endpoints, request shapes, response content types, outline stream frames, and bookmark AI permissions.
- Do not migrate stored rows. Rows written while the JSON instruction was live keep their stored value until the summary is regenerated.
- Non-goals: changing the frontend, adding a server-side parser or normalizer as a safety net, deleting or repurposing `/v1/bookmark/outline`, aligning the `lang` a generation writes with the `lang` read paths look up, and cleaning up stored rows.

## Capabilities

### New Capabilities

- `bookmark-ai-outline`: what the outline/summary generation asks the model for, and the guarantee that the API forwards that output to clients and storage unchanged.

### Modified Capabilities

None. Existing capabilities (`agentic-pr-review`, `frontend-local-environment`, `frontend-preflight`, `release-branching`) are unaffected.

## Impact

- `apps/api/src/const/prompt.ts`: `systemPrompt` loses the JSON output block; this prompt is used by outline generation (`/v1/bookmark/outline`) and summary generation (`POST /v1/aigc/summaries`).
- `apps/api/src/domain/aigc.ts` and `apps/api/src/domain/bookmark.ts`: back to their pre-change state (no envelope handling).
- Clients (`/v1/aigc/summaries` stream and cached response, `GET /v1/bookmark/summaries`, the `outline` field of the bookmark detail trace, the MCP summary resource, `/v1/bookmark/outline` frames) receive exactly what the model produced.
- No database schema change, no data migration, no deployment, no secret access.
- Verification limit: the prompt is the whole fix, so the definitive check is one live generation against the local stack; automated tests can only pin the prompt text and the absence of a transformation layer.
