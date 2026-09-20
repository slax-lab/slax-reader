#!/usr/bin/env bash
# Fails when the compiled agentic workflows (*.lock.yml) no longer match their
# Markdown sources. CI enforces the same invariant in agent-config.yml; this
# copy exists because `pnpm agent:check` and the lefthook pre-commit hook have
# to see the drift locally, where otherwise the only signal was a red PR.
#
# Why not `gh aw compile --check`: gh-aw has no read-only mode, so the check has
# to compile and then compare. CI compares the result against HEAD (its checkout
# is clean); this compares against the index instead, because at pre-commit time
# regenerated lock files are normally already staged and would otherwise be
# reported as drift against themselves.
#
# The gh-aw CLI version is pinned in agent-config.yml. Install the matching one
# with `gh extension install github/gh-aw`.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

if ! gh aw --version >/dev/null 2>&1; then
  echo "The gh-aw extension is required to check for compiled-workflow drift." >&2
  echo "Install it with 'gh extension install github/gh-aw', matching the version pinned in .github/workflows/agent-config.yml." >&2
  exit 1
fi

# The compiled output pins the CLI version that produced it, so a mismatched
# local gh-aw would emit different hashes. That would fail here and then tell the
# developer to stage exactly that output — which fails CI instead. Fail before
# compiling, with a diagnosis that names the real problem.
PINNED=$(sed -n 's/^[[:space:]]*version:[[:space:]]*\(v[0-9][0-9.]*\)[[:space:]]*$/\1/p' .github/workflows/agent-config.yml | head -n 1)
LOCAL=$(gh aw --version 2>&1 | sed -n 's/.*\(v[0-9][0-9.]*\).*/\1/p' | head -n 1)
if [ -z "$PINNED" ]; then
  echo "Could not read the pinned gh-aw version from .github/workflows/agent-config.yml." >&2
  exit 1
fi
if [ "$LOCAL" != "$PINNED" ]; then
  echo "gh-aw version mismatch: this checkout has ${LOCAL:-an unrecognized version}, CI pins $PINNED." >&2
  echo "Install the pinned version before recompiling, otherwise the hashes you generate will not match CI:" >&2
  echo "  gh extension remove gh-aw && gh extension install github/gh-aw --pin $PINNED" >&2
  exit 1
fi

# A *full* compile is required: compiling single files does not purge orphaned
# lock files, so a per-file check would miss exactly the drift that matters.
# Mirrors the "gh-aw compile drift check" step of agent-config.yml — same flags,
# same path list, kept in step by hand.
gh aw compile --strict --purge --no-check-update

DRIFT=$(
  git diff --name-only -- '.github/workflows/*.lock.yml' '.github/aw'
  git ls-files --others --exclude-standard -- '.github/workflows/*.lock.yml' '.github/aw'
)

if [ -n "$DRIFT" ]; then
  echo "Compiled agentic workflows are out of date:" >&2
  echo "$DRIFT" >&2
  echo "Stage the regenerated files above." >&2
  exit 1
fi

echo "Compiled workflows match their sources."
