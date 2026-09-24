#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
cd "$ROOT"

usage() {
  cat <<'EOF'
Internal infrastructure setup; use pnpm api -- setup

Initializes the local backend dev environment without starting dev servers:
  1. verify node >= 22, pnpm, docker compose + daemon
  2. pnpm install --frozen-lockfile
  3. start local postgres and create local databases (idempotent)
  4. prisma migrate deploy (pgsql + logs)
  5. local D1 migrations (main + fulltext)
  6. codegen (pnpm api -- gen:all)
  7. start powersync services

The public setup command validates configuration and runs Wrangler login before this script. Start Workers separately with pnpm api -- dev. --no-start is accepted for compatibility.
EOF
}
for arg in "$@"; do
  case "$arg" in
    --no-start) ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      echo "!! unknown argument: $arg" >&2
      usage >&2
      exit 1
      ;;
  esac
done

say() { echo ">> $*"; }
die() {
  echo "!! $*" >&2
  exit 1
}

command -v node >/dev/null 2>&1 || die "node is not installed"
NODE_VERSION="$(node -p 'process.versions.node')"
NODE_MAJOR="${NODE_VERSION%%.*}"
case "$NODE_MAJOR" in
  '' | *[!0-9]*) die "could not parse node version: $NODE_VERSION" ;;
esac
IFS=. read -r NODE_MAJOR NODE_MINOR NODE_PATCH <<< "$NODE_VERSION"
if [ "$NODE_MAJOR" -lt 22 ] || { [ "$NODE_MAJOR" -eq 22 ] && { [ "$NODE_MINOR" -lt 13 ]; }; }; then
  die "node >= 22.13.0 required (found v$NODE_VERSION)"
fi

command -v pnpm >/dev/null 2>&1 || die "pnpm is not installed"
command -v docker >/dev/null 2>&1 || die "docker is not installed"
docker compose version >/dev/null 2>&1 || die "docker compose plugin is not available"
docker info >/dev/null 2>&1 || die "docker daemon is not running"

# pin local postgres URLs so prisma configs never pick up a remote URL
# inherited from the shell environment
export HYPERDRIVE_DATABASE_URL="postgresql://admin:admin@localhost:15432/slax-reader-backend-internal"
export LOGS_DATABASE_URL="postgresql://admin:admin@localhost:15432/slax-reader-logs"

CONFIG_FILE="${SLAX_API_CONFIG:-deploy/local/api.toml}"
if [ ! -f "$CONFIG_FILE" ]; then
  die "API configuration is missing; check SLAX_API_CONFIG or run pnpm api -- config:init first"
fi

say "installing dependencies"
pnpm install --frozen-lockfile

say "checking complete local configuration"
pnpm api -- setup --check

say "starting postgres and ensuring databases (idempotent)"
bash deploy/local/powersync-local/init.sh --postgres-only

say "applying prisma migrations (pgsql)"
pnpm api -- migration:deploy:pgsql
say "applying prisma migrations (logs)"
pnpm api -- migration:deploy:logs
say "applying local d1 migrations"
pnpm api -- migration:local:d1
pnpm api -- migration:local:fulltext
say "generating code"
pnpm api -- gen:all

say "starting powersync services"
bash deploy/local/powersync-local/init.sh
say "Local infrastructure is healthy. API Workers have not been started."
echo ">> note: remote cloudflare bindings require 'wrangler login' or CLOUDFLARE_API_TOKEN; application secrets belong in deploy/local/.dev.vars"
