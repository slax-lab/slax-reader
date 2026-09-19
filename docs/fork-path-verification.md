# Fork path verification (temporary)

This file exists only so a pull request can be opened **from a fork**, which is
the one path the review system has never been exercised on: the agent job must be
skipped, no model credential may be used, and the `Agentic PR review` check must
still report a result (skipped counts as success) so the pull request is not left
waiting on an unreported required check.

The pull request is closed without merging and both branches are deleted.
