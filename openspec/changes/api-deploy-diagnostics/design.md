# Design

## Context

The existing workflow stores private configuration and generated Core configuration in runner temporary storage. The existing API generator rewrites migration paths relative to generated configuration; Wrangler resolves them from that file's directory. See proposal.md for the operational problem.

## Goals / Non-Goals

**Goals:** Verify effective paths before opening access and emit useful numeric or fixed-category failure results.

**Non-Goals:** Change configuration generation, environment selection, deployment triggers, schema history or runtime behavior; run live migrations during verification.

## Decisions

- Keep checks inline in the existing YAML. Generate Core configuration with the existing API helper, then verify both bindings against the checkout's SQL folders; inspecting the downloaded TOML alone would miss generator rewrites.
- Capture raw output as before. Classify migration failures with fixed patterns and extract only numeric Cloudflare error codes; printing raw messages could expose private resource identities or SQL values.
- Preserve failed command exit status. Enable Bash ERR inheritance and report fixed firewall stages with HTTP/curl statuses. Existing cleanup retains ownership checks and removes temporary data.

## Risks / Trade-offs

- Unknown diagnostics remain generic except for exit status; this preserves confidentiality while permitting future explicit categories.
- Path verification proves local directory resolution, not D1 authorization or SQL compatibility. The previously observed live failure still requires a subsequent safe error result.

## Migration Plan

Merge the workflow update through the normal dev PR. No additional Secrets or configuration changes are needed. Revert this workflow diff if its preflight checks regress deployment.
