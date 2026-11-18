# Store Newsletter receiving names independently of domains

## Why
Newsletter platform bindings currently persist a complete receiving email address. Changing the configured receiving domain therefore requires editing each binding. A binding should instead represent the fixed receiving name.

## What Changes
- Store only the confirmed receiving name in both `platform_id` and `user_name` for `platform=newsletter`.
- Build the complete display/confirmation address from `feed+`, the bound name and current `NEWSLETTER_DOMAIN`.
- Reserve and look up the bound name independently of the domain, while validating the SMTP envelope domain before lookup.
- Clarify setup copy: the receiving name is fixed; the domain is controlled by service configuration.
- Keep public request/response shapes, layering, account validation, existing locks and deletion reservations.

## Scope
No DDL, migrations, legacy reads, data conversion, RSS, R2, PowerSync, Mobile or configuration-repository changes. Operators own any existing-data edits and coordinate rollout; old full-address rows are not supported.

## Approval
The user approved this design in conversation on 2026-11-18, explicitly excluding legacy-data compatibility and conversion, and requested implementation in a new worktree. This is a copy correction within the existing setup flow, not a material UX redesign.
