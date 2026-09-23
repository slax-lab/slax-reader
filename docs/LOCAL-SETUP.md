# Local Development Setup

Onboarding runbook for new team members. Hand this file to your coding agent;
it can execute the whole setup except the steps marked **[HUMAN]**, which need
files, credentials, or a browser that only you can provide.

**Agent instructions**

- Execute phases in order. Each phase ends with a *Verify* command; it must
  pass before moving on. If it fails, show the user the raw error output.
- At a **[HUMAN]** step, stop and ask the user for the listed item. Never
  invent or guess secret values.
- Write secrets only into the gitignored files named in this document. Never
  print secret values into logs, and never commit them.

## Phase 0 — The config bundle [HUMAN]

This project keeps its local configuration in `local.zip`, an internal bundle
of gitignored files. Ask the user to place `local.zip` at the repository root.
If it is not there, stop and wait for it; do not proceed with placeholder
values.

## Phase 1 — System prerequisites

| Tool | Requirement | Verify |
| --- | --- | --- |
| Node.js | `^22.22.2 \|\| ^24.15.0 \|\| >=26` — use an LTS line (22 or 24); Node 25 is not supported | `node --version` |
| pnpm | exact version pinned in root `package.json` (`packageManager` field; `corepack enable` provides it) | `pnpm --version` |
| Docker | running daemon, Compose with `up --wait` support | `docker info && docker compose version` |
| Git | any recent version | `git --version` |

Optional: Stripe CLI, only if you will work on payment webhooks.

## Phase 2 — Clone and install

```bash
git clone https://github.com/slax-lab/slax-reader.git && cd slax-reader
pnpm install --frozen-lockfile
```

*Verify:* `pnpm preflight` — runtime and dependency checks green. Environment
variable errors are expected at this point; Phase 3 fixes them.

## Phase 3 — Configuration materials

1. Confirm `local.zip` is at the repository root (Phase 0). Inspect it with
   `unzip -l` and extract it so that its contents land at `deploy/local/`.
   The bundle is the complete local configuration directory — including the
   PowerSync certificates — and restores every gitignored file the backend
   needs.
2. Frontend environment files live in `deploy/local_web/.env` and
   `deploy/local_extension/.env`. These are being migrated into
   `deploy/local/`; if the bundle already contains them, nothing more to do.
   Otherwise copy the corresponding `.env.example` files and ask the user
   **[HUMAN]** for the shared `GOOGLE_OAUTH_CLIENT_ID`. Optional keys
   (GTM, Apple/Turnstile, GA) stay empty to disable the feature — see the
   comments in each `.env.example`.
3. Once the *Verify* step below passes, delete `local.zip` from the
   repository root so it is never committed.

*Verify:* `pnpm preflight && pnpm api -- setup:api --check` — all green.
These checks are the contract for what the bundle must contain; if one
reports missing material, either the zip was unpacked to the wrong location
(`deploy/local/` is the target) or the bundle itself is stale — confirm
with the user.

## Phase 4 — Backend initialization

```bash
pnpm api -- setup:api
```

This runs `wrangler login` once (**[HUMAN]**: browser authorization with the
user's own Cloudflare account), then starts PostgreSQL, runs migrations and
code generation, waits for PowerSync health, and exits. It does not start the
Workers.

*Verify:* the command exits with "API setup complete".

## Phase 5 — Run

Start each service in its own terminal:

```bash
pnpm api -- dev          # Workers on http://localhost:8787
pnpm web -- dev          # reader on http://localhost:3000
pnpm extension -- dev    # extension build with watch
```

*Done when:* the reader loads at `http://localhost:3000` and login works
against the local API.

## Troubleshooting

- `tsx: command not found` / `spawn ENOENT` when running `pnpm api -- ...`:
  the `apps/api` workspace dependencies are missing. Run
  `pnpm install --frozen-lockfile` at the repository root, then retry.
  (The dispatcher itself only needs root dependencies, so this failure
  surfaces inside the app, not at the command entry.)
- pnpm warns `Unsupported engine ... (current: {"node":"v25.x"})`:
  switch to Node 22 LTS or 24 LTS.
- `pnpm preflight` and `setup:api --check` messages are self-describing; fix
  the ✗ items and re-run.
- Backend setup details: `docs/api/DEV-AND-CI-CN.md`.
- `setup:api` never creates or rewrites configuration; missing material means
  a Phase 3 item is incomplete.
