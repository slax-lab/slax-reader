# apps/backend

The Slax Reader backend: Cloudflare Workers that serve the HTTP API and run the scheduled jobs, queue consumers, and WebSocket endpoints behind it.

## Layout: one subdirectory per Worker

**Every Worker gets its own subdirectory, and every Worker is a separate deployable with its own wrangler configuration.**

```text
apps/backend/
├── <worker-name>/        # e.g. the HTTP API worker
│   ├── wrangler.toml     # this Worker's wrangler config, including its env sections
│   ├── src/
│   └── ...
└── <worker-name>/        # another Worker, deployed on its own
    ├── wrangler.toml
    └── ...
```

Rules that follow from this:

- A Worker's wrangler config lives inside that Worker's directory, next to the code it deploys. Never share one config across Workers.
- Each Worker is built and deployed independently, so one Worker's deploy must not require another Worker's build to succeed.
- Do not nest a Worker inside another Worker's directory. Sibling directories only.
- Keep per-environment secrets out of git (`.dev.vars` and similar local env files are already gitignored at the repository root).

## What belongs here

- Worker entrypoints, routes and handlers, scheduled jobs, queue consumers, and the bindings configuration for each Worker.
- Worker-local tests, kept next to the code they test.

## What does not belong here

- **Shared backend code goes to `packages/`.** When two Workers need the same module, promote it to a package and import it by package name — do not import across Worker directories by relative path, and do not copy the code into both.
- Cross-app end-to-end and integration tests — they go in `tests/e2e/`.

## Migration source

[`slax-lab/slax-reader-api`](https://github.com/slax-lab/slax-reader-api) — today that repository is a single Worker with `src/worker.ts` as its entrypoint and its wrangler configs under `config/`. Migration means splitting it into this one-directory-per-Worker layout and moving the wrangler configs next to the Workers they deploy.

## Interim owner

@boxcounter — interim owner until a dedicated code owner is assigned. See `.github/CODEOWNERS`.
