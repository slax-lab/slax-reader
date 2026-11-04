# Proposal

## Why

Podcast audio transcription cannot work on the deployed API. `AssemblyAIClient.call` invokes `this.fetcher(...)`. The default `fetcher` is native `fetch`. On Workers, a native `fetch` called as a method of another object throws `Illegal invocation`. Every AssemblyAI request fails before it leaves the Worker.

A real Worker run confirmed this on 2026-10-31. The `dev` client, bundled into workerd with the API runtime compatibility settings, sent no request and threw `Illegal invocation`. The defect was first found during PR #413 local testing; that PR is not merged.

Episodes without a publisher transcript therefore never get a transcript or an article.

## What Changes

- Call the stored fetch function without binding it to the client.
- Add a regression test whose fetch rejects a bound `this`, as the Workers runtime does.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `podcast-article`: the AssemblyAI path of "Transcript source and billing" runs on the Workers runtime.

## Impact

One line in `apps/api/src/infra/external/assemblyAI.ts`, and one unit test. No API contract, dependency, migration, configuration, or user interface change. No packaged CLI, Extension, or Mobile code changes.

## Sequencing

The unarchived changes `add-bookmark-fork` and `capture-pocket-casts` also carry `podcast-article` deltas. They modify other requirements. Archive this change after them.

## Approval

Luca approved splitting this fix out of PR #413 in conversation on 2026-10-31.
