# Spec Delta

## REMOVED Requirements

### Requirement: Automatic review admits the archive bot after human approval

The automatic pull request review workflow SHALL allow `github-actions[bot]` as an actor so that a human-approved archive PR workflow can activate and execute the review agent. This admission SHALL apply only to the automatic review workflow. The on-demand `/review` command workflow SHALL retain its existing actor restrictions and SHALL NOT admit bot-authored review commands. Human workflow approval remains required for runs created with the default `GITHUB_TOKEN`.

**Reason**: Approving a bot-created PR starts its automatic review but does not reliably trigger the downstream `workflow_run` gate. A human ready-for-review transition supplies the correct actor and has already been observed to complete the gate and notification path, so the bot allowlist is unnecessary.

**Migration**: Keep archive PRs as drafts and instruct the task PR author to inspect the archive and click **Ready for review**. Remove the bot allowlist from automatic review; do not change the on-demand `/review` actor rules used by other PRs.
