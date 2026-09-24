# Local Development Setup

Onboarding runbook for new team members. Hand this file to your coding agent;
it can execute the whole setup except the steps marked **[HUMAN]**, which need
files, credentials, or a browser that only you can provide.

**Agent instructions**

- Execute phases in order. Each phase ends with a _Verify_ command; it must
  pass before moving on, except where a phase explicitly expects incomplete
  preflight readiness. Report safe diagnostics without printing secret values.
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

| Tool    | Requirement                                                                                         | Verify                                  |
| ------- | --------------------------------------------------------------------------------------------------- | --------------------------------------- |
| Node.js | `^22.22.2 \|\| ^24.15.0 \|\| >=26` — use an LTS line (22 or 24); Node 25 is not supported           | `node --version`                        |
| pnpm    | exact version pinned in root `package.json` (`packageManager` field; `corepack enable` provides it) | `pnpm --version`                        |
| Docker  | running daemon, Compose with `up --wait` support                                                    | `docker info && docker compose version` |
| Git     | any recent version                                                                                  | `git --version`                         |

Optional: Stripe CLI, only if you will work on payment webhooks.

## Phase 2 — Clone and install

```bash
git clone https://github.com/slax-lab/slax-reader.git && cd slax-reader
pnpm install --frozen-lockfile
```

_Verify:_ `pnpm preflight` — runtime and dependency checks green. Configuration,
generated-state, and service findings are expected at this point, so a non-zero exit is normal; Phases 3 and 4 address them.

## Phase 3 — Configuration materials

1. Confirm `local.zip` is at the repository root (Phase 0). Inspect it with
   `unzip -l` and extract it so that its contents land at `deploy/local/`.
   The bundle restores the gitignored local configuration the project needs,
   including `api.toml`, `.dev.vars`, and the PowerSync signing key. Current
   setup derives PowerSync's public verification parameters in memory; separate
   key or `compose.env` files are not required.
2. Once the _Verify_ step below passes, delete `local.zip` from the
   repository root so it is never committed.

_Verify:_ `pnpm api -- setup --check` confirms that the API configuration and
Docker prerequisites are usable. Run `pnpm preflight` as a diagnostic at this
stage; it may exit non-zero because API services and frontend generated state
are not initialized yet. These checks are the contract for what the bundle must
contain; if setup-check reports missing material, either the zip was unpacked
to the wrong location (`deploy/local/` is the target) or the bundle itself is
stale — confirm with the user.

## Phase 4 — Repository initialization

```bash
pnpm setup:all
```

This runs API setup, Web setup, and Extension setup in order. API setup runs
`wrangler login` once (**[HUMAN]**: browser authorization with the user's own
Cloudflare account), starts PostgreSQL, runs migrations and code generation,
waits for PowerSync health, and exits. The frontend steps generate Nuxt and
WXT state. No Worker or frontend dev server is started.

_Verify:_ the command exits successfully and prints the final `setup:all`
completion message; `pnpm preflight` then exits zero.

## Phase 5 — Rerun an individual module

```bash
pnpm web -- setup
pnpm extension -- setup
pnpm api -- setup
```

Use an individual command when only one module's generated state was deleted.
Web setup generates Nuxt's `.nuxt/`, Extension setup generates WXT's `.wxt/`,
and API setup prepares PostgreSQL, migrations, generated code, and PowerSync.
Rerun the affected command after wiping local caches or generated directories.
The frontend setup commands must run once after a fresh install and after their
generated directory is removed; otherwise the first `dev` run can report a
missing generated TypeScript configuration such as `./.wxt/tsconfig.json`.

_Verify:_ each requested command exits without error, then run `pnpm preflight` again.

## Phase 6 — Run

Start each service in its own terminal:

```bash
pnpm api -- dev          # Workers on http://localhost:8787
pnpm web -- dev          # reader on http://localhost:3000
pnpm extension -- dev    # extension build with watch
```

_Done when:_ the reader loads at `http://localhost:3000` and login works
against the local API.

## Reading preflight results

Each module starts with one status, followed by actionable details:

| Status | Meaning | Examples |
| --- | --- | --- |
| `当前无法启动` (cannot start) | A startup prerequisite is missing or invalid. | Unsupported Node.js, missing dependencies, malformed config, missing Nuxt/WXT or imported Prisma/DI output; invalid Extension `PUBLIC_BASE_URL`. |
| `可启动，但无法正常运行` (can start, functionality incomplete) | Startup checks pass, but required features cannot work normally. | Docker unavailable, PostgreSQL/PowerSync unhealthy, uninitialized local D1 state, missing API signing secrets, missing Google login or cookie/API settings. |
| `启动检查通过` (startup checks passed) | All selected startup and functionality checks passed. | Required preparation and configuration are present; no known local dependency failures. |

`【阻止启动】` identifies startup blockers and takes precedence over
`【功能受限】` in module headings. Both classes return exit code **1** and are
counted separately. Optional Apple OAuth/Turnstile settings and ordinary
reminders do not fail preflight. Resolve blockers first, then functionality
findings; every finding gives a command or configuration location to use.

The default checks API, Web, and Extension. Known API failures also affect
Web/Extension integration status, and known Web failures affect Extension.
Use `--app api`, `--app web`, or `--app extension` to focus on one module;
narrow checks do not validate all peers. API configuration validation runs even
when Docker is unavailable. `--env` selects a frontend profile; API selection
uses `SLAX_API_CONFIG` and `SLAX_API_ENV`.

A passing result does not mean dev servers are running, credentials work with
providers, or cloud resources and end-to-end flows have been verified. Start
the services separately and complete the Phase 6 acceptance check.

## Troubleshooting

- `tsx: command not found` / `spawn ENOENT` when running `pnpm api -- ...`:
  the `apps/api` workspace dependencies are missing. Run
  `pnpm install --frozen-lockfile` at the repository root, then retry.
  (The dispatcher itself only needs root dependencies, so this failure
  surfaces inside the app, not at the command entry.)
- pnpm warns `Unsupported engine ... (current: {"node":"v25.x"})`:
  switch to Node 22 LTS or 24 LTS.
- `pnpm preflight` and `setup --check` messages are self-describing; fix
  `【阻止启动】` and `【功能受限】` items and rerun. For Docker installation,
  use [Docker's official guide](https://docs.docker.com/get-docker/). For
  stopped PostgreSQL/PowerSync containers, rerun `pnpm api -- setup`.
- Backend setup details: `docs/api/DEV-AND-CI-CN.md`.
- `setup` never creates or rewrites configuration; missing material means
  a Phase 3 item is incomplete.
