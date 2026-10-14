#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOCAL_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
COMPOSE_FILE="$LOCAL_ROOT/dockerfile-local-pgsql.yaml"
PG_CONTAINER="dev-postgres"

POSTGRES_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --postgres-only) POSTGRES_ONLY=1 ;;
    -h | --help)
      echo "usage: $0 [--postgres-only]"
      exit 0
      ;;
    *)
      echo "!! unknown argument: $arg" >&2
      exit 1
      ;;
  esac
done

if [ "$POSTGRES_ONLY" -eq 0 ]; then
  for name in PS_JWK_N PS_JWK_E PS_JWK_KID; do
    if [ -z "${!name:-}" ]; then
      echo "!! missing $name; use pnpm api -- setup to derive public verification parameters from the API signing key" >&2
      exit 1
    fi
  done
fi

echo ">> starting postgres container"
docker compose -f "$COMPOSE_FILE" up -d postgres

echo ">> waiting for postgres to accept connections"
ATTEMPTS=0
MAX_ATTEMPTS="${PG_READY_MAX_ATTEMPTS:-30}"
until docker exec "$PG_CONTAINER" pg_isready -h 127.0.0.1 -U admin >/dev/null 2>&1; do
  ATTEMPTS=$((ATTEMPTS + 1))
  if [ "$ATTEMPTS" -ge "$MAX_ATTEMPTS" ]; then
    echo "!! postgres did not become ready within ${MAX_ATTEMPTS}s" >&2
    exit 1
  fi
  sleep 1
done

psql_admin() {
  docker exec -i "$PG_CONTAINER" psql -v ON_ERROR_STOP=1 -U admin -d "$1"
}

echo ">> ensuring databases exist"
psql_admin postgres <<'SQL'
SELECT 'CREATE DATABASE "slax-reader-backend-internal"' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'slax-reader-backend-internal')\gexec
SELECT 'CREATE DATABASE "slax-reader-logs"' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'slax-reader-logs')\gexec
SELECT 'CREATE DATABASE "powersync"' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'powersync')\gexec
SQL

echo ">> ensuring replication role and publication on slax-reader-backend-internal"
psql_admin slax-reader-backend-internal <<'SQL'
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'powersync_role') THEN
    CREATE ROLE powersync_role WITH REPLICATION BYPASSRLS LOGIN PASSWORD 'myhighlyrandompassword';
  END IF;
END
$$;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO powersync_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO powersync_role;
SELECT 'CREATE PUBLICATION powersync FOR ALL TABLES' WHERE NOT EXISTS (SELECT FROM pg_publication WHERE pubname = 'powersync')\gexec
SQL

if [ "$POSTGRES_ONLY" -eq 0 ]; then
  echo ">> starting powersync services"
  if ! docker compose --env-file /dev/null -f "$COMPOSE_FILE" up -d --wait --wait-timeout "${POWERSYNC_READY_TIMEOUT:-120}"; then
    echo "!! PowerSync startup failed or health checks timed out; setup is incomplete." >&2
    docker compose --env-file /dev/null -f "$COMPOSE_FILE" ps -a >&2 || true
    echo "!! Check Docker image access, local ports 18080/18081, PowerSync keys and PostgreSQL connectivity." >&2
    echo "!! Inspect service logs locally: docker compose --env-file /dev/null -f deploy/local/dockerfile-local-pgsql.yaml logs --tail 80 powersync powersync-api" >&2
    exit 1
  fi
  echo ">> PowerSync healthy: http://localhost:18080 (unified), http://localhost:18081 (API)"
fi

echo ">> init done"
