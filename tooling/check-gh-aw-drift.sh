#!/usr/bin/env bash
# Fails when the agentic workflows in a commit cannot be reproduced from the
# sources committed alongside them: the compiled *.lock.yml — and the actions lock
# gh-aw maintains — must match what those sources compile to. CI enforces the same
# invariant in agent-config.yml; this copy exists because `pnpm agent:check` and
# the lefthook pre-commit hook have to see the drift locally, where otherwise the
# only signal was a red PR.
#
# Why not `gh aw compile --check`: gh-aw has no read-only mode, so the check has
# to compile and then compare. CI compares the result against HEAD (its checkout
# is clean); this compares against the index instead, because at pre-commit time
# regenerated lock files are normally already staged and would otherwise be
# reported as drift against themselves.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

# agent-config.yml pins the CLI that CI compiles with, and that pin is the only
# version whose output matches what CI expects. Read it first: both failure
# messages below need it, and an unreadable pin must not silently skip the check.
#
# The pin has to come from the `github/gh-aw/actions/setup-cli` step itself, not
# from whichever `version:` line happens to appear first: another action's version
# input placed earlier in the file would be read as the gh-aw pin, and a wrong pin
# rejects the correct CLI (or accepts a wrong one) before any comparison runs.
PINNED=$(awk '
  /^[[:space:]]*-[[:space:]]/ { in_step = 0 }
  /^[[:space:]]*uses:[[:space:]]*github\/gh-aw\/actions\/setup-cli([@[:space:]]|$)/ { in_step = 1; next }
  in_step && /^[[:space:]]*version:[[:space:]]*v[0-9]/ {
    sub(/^[[:space:]]*version:[[:space:]]*/, "")
    sub(/[[:space:]]+$/, "")
    print
    exit
  }
' .github/workflows/agent-config.yml)
if [ -z "$PINNED" ]; then
  echo "Could not read the pinned gh-aw version from .github/workflows/agent-config.yml." >&2
  exit 1
fi
INSTALL_HINT="gh extension install github/gh-aw --pin $PINNED"

if ! gh aw --version >/dev/null 2>&1; then
  echo "The gh-aw extension is required to check for compiled-workflow drift." >&2
  echo "Install the version CI pins with:" >&2
  echo "  $INSTALL_HINT" >&2
  exit 1
fi

# The compiled output records the CLI version that produced it, so a mismatched
# local gh-aw would emit different hashes. That would fail here and then tell the
# developer to stage exactly that output — which fails CI instead. Fail before
# compiling, with a diagnosis that names the real problem.
#
# `gh aw --version` writes "gh aw version v0.88.7" to *stderr*. Take the last
# token of the first line and check its shape, so a format change reports itself
# as a format change instead of as a version mismatch.
LOCAL=$(gh aw --version 2>&1 | tr -d '\r' | sed -n '/./{s/.*[[:space:]]//;p;q;}')
case "$LOCAL" in
  v[0-9]*.[0-9]*.[0-9]*) ;;
  *)
    echo "Unrecognized 'gh aw --version' output: '${LOCAL}'." >&2
    echo "Expected a trailing v<major>.<minor>.<patch> token; CI pins $PINNED." >&2
    exit 1
    ;;
esac
if [ "$LOCAL" != "$PINNED" ]; then
  echo "gh-aw version mismatch: this checkout has $LOCAL, CI pins $PINNED." >&2
  echo "Install the pinned version before recompiling, otherwise the hashes you generate will not match CI:" >&2
  echo "  gh extension remove gh-aw && $INSTALL_HINT" >&2
  exit 1
fi

# A *full* compile is required: compiling single files does not purge orphaned
# lock files, so a per-file check would miss exactly the drift that matters.
# Mirrors the "gh-aw compile drift check" step of agent-config.yml — same flags.
# CI compares only the generated files, because its checkout is clean and the
# sources it compiles are therefore the committed ones; this script does not have
# that guarantee, so its path list reaches the compile inputs as well.
gh aw compile --strict --purge --no-check-update

# Both sides of the compile are compared against the index, not just the compiled
# output. Generated files alone leave a half-staged change undetected: keep a
# source edit in the worktree, stage only the recompiled lock, and the lock shows
# no diff — yet that commit pairs a new lock with the old source, so CI fails on
# exactly the drift this guard exists to catch.
#
# The comparison is worktree-vs-index, so an unstaged compile input is reported
# even when the staged sources and locks agree with each other. That is
# deliberate: a false alarm costs one commit retry, a missed one costs a red CI
# run plus a recompile, and only the second is silent at commit time.
GUARDED=(
  # compile inputs
  '.github/workflows/*.md'
  '.github/workflows/shared/**'
  '.github/workflows/*.json'
  # compile output
  '.github/workflows/*.lock.yml'
  # the actions lock gh-aw maintains
  '.github/aw'
)

DRIFT=$(
  git diff --name-only -- "${GUARDED[@]}"
  git ls-files --others --exclude-standard -- "${GUARDED[@]}"
)

if [ -n "$DRIFT" ]; then
  echo "The staged content of this commit would fail the CI drift check:" >&2
  echo "$DRIFT" >&2
  echo "Each path above differs from the index or is untracked, so the sources and" >&2
  echo "what they compile to are not being committed together. Stage the sources," >&2
  echo "recompile with 'gh aw compile --strict --purge --no-check-update', and stage" >&2
  echo "the regenerated files as well." >&2
  exit 1
fi

echo "Compiled workflows match their sources."
