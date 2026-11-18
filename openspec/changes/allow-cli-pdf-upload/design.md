## Context

The CLI authenticates with a Reader API key. The route allowlist is evaluated before the PDF handler identifies the owner, checks the account and calls the PDF service.

## Goals / Non-Goals

Support the original file upload through the existing authenticated endpoint. CLI command design, publishing rules and changes to account eligibility are outside the scope of this change.

## Decisions

Admit only POST on the exact path /v1/bookmark/upload_pdf for this addition. The existing key verification supplies the owner ID. Let the existing handler and service perform all subsequent checks. Publisher recommendation eligibility remains independent of authentication for this endpoint.

## Risks / Trade-offs

API key holders who enable PDF Labs gain the same storage-consuming operation available in the application. Cover a disabled account and an invalid upload during verification. Check method and path boundaries in the middleware tests.
