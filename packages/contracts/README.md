# @slax-reader/contracts

Shared HTTP, domain-data and event contracts for Web, Extension, CLI and API. This package must not depend on Prisma, Cloudflare bindings, server Context, Vue, browser APIs, Nuxt or WXT.

```ts
import { ErrorName, MarkType } from '@slax-reader/contracts'
import type { ApiResponse, ApiKeyListItem, AddUrlBookmarkRequest } from '@slax-reader/contracts'

const request: AddUrlBookmarkRequest = { target_url: 'https://example.com', tags: [] }
type KeyListResponse = ApiResponse<ApiKeyListItem[]>
```

Workspace consumers declare `"@slax-reader/contracts": "workspace:*"` in their own `package.json` and import from the package name. In addition to the root entry, consumers may use `/http`, `/errors`, `/bookmarks`, `/marks`, `/tags`, `/collections`, `/api-keys`, `/events`, and the compatibility subpaths `/analytics`, `/const`, `/interface` and `/openai`. Do not import across application boundaries from `apps/api`.

This is a private source package. Its exports point to TypeScript and are compiled by the consuming application's TypeScript toolchain, Wrangler or frontend bundler. It is not published to npm and does not provide compiled JavaScript for direct execution by ordinary Node.js programs.

## Contract boundaries

- `ApiResponse<T>` is `{ data, message, code }`; `data` may be omitted when `T` includes `undefined`. `null` and omission are distinct. The body `code` is not guaranteed to equal the HTTP status.
- DTOs use JSON date strings by default. API internals may use `Date` generics before serialization without changing existing Date objects or serialization behavior.
- Hash IDs are currently numbers and UUIDs are strings. Historical spelling and field names remain compatible.
- Only genuinely shared pagination structures belong here. Interface-specific defaults, limits and parameter names stay with their API.
- `/events` uses its own bare response, `{ received, dropped }` or `{ error }`, rather than the regular envelope. The server still validates input, resolves identity and submits internal events.
- Types do not validate network input. Request parsing, authorization and runtime validation remain in the API controllers.

## Current coverage

The package covers public error names and `MarkType`, response envelopes, pagination, bookmark creation/edit/tag requests and export results, mark creation/deletion/list responses, tag requests and responses, collection settings and lists, API key requests and responses, client events, and the routes, analytics, AI streaming responses and compatibility DTOs currently used by Web and Extension. The API keeps aliases for internal compatibility, but this package is the canonical definition.

Database PO types, Worker environment types, internal queues/workflows and authentication implementations do not belong here. Other HTTP interfaces that have not been reviewed remain in the API and must not be treated as fully checked public contracts.

## Verification

`pnpm --filter @slax-reader/contracts typecheck` checks the source and consumer sample without requiring Node, DOM or Cloudflare ambient types. `pnpm api -- typecheck` includes this check, and `pnpm api -- test` includes controller serialization compatibility tests. Changes to contracts also require Web and Extension type checks.

[Chinese documentation](README_CN.md)
