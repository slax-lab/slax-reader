# CLI development

The CLI was imported from [slax-lab/slax-reader-cli](https://github.com/slax-lab/slax-reader-cli) at commit `9697ec2949049d2e7ef0258cd7b9b6df2142007a`. Application source lives in `apps/cli`, guides in `docs/cli`, and the consumer agent skill in `apps/cli/skills/slax-reader`. The upstream MIT declaration and slax-lab attribution are preserved in `apps/cli/LICENSE`; the rest of the monorepo retains its existing license.

## Requirements and commands

Use the root pinned pnpm and Node.js `^22.22.2 || ^24.15.0 || >=26.0.0` (prefer Node 22 or 24 LTS). The legacy Node 18 claim was incompatible with the upstream dependencies.

From the repository root:

```bash
pnpm install --frozen-lockfile
pnpm cli -- typecheck
pnpm cli -- build
pnpm cli -- start --help
pnpm cli -- test
pnpm cli -- test:package
pnpm test:cli-tooling
```

`pnpm cli -- dev` watches the build; `pnpm cli -- start <arguments>` runs the built CLI. Dispatcher help is `pnpm cli -- --help`. The CLI does not load `deploy/local` environment files or need Docker, `setup:all`, or local backend services for build/tests. Existing preflight/setup orchestration remains limited to API, Web and Extension.

Tests use isolated temporary configuration, synthetic keys and a local HTTP server, exercising real executable processes. Package verification packs and installs the archive into a separate directory, then verifies the installed binary and authenticated local requests. To verify an already packed archive without repacking:

```bash
pnpm cli -- test:package /absolute/path/to/slax-lab-reader-cli-1.0.0.tgz
```

## Authentication and shared contracts

The npm identity remains `@slax-lab/reader-cli`, with binary `reader-cli`. The existing `reader-cli` user configuration namespace, saved API base/key and version/skill state files remain unchanged; no credential migration or forced login is needed. Use interactive `pnpm cli -- start login` when you want to authenticate. Never commit or print credentials.

Shared request/envelope types are type-only development imports from `@slax-reader/contracts`. The published package has no dependency on that private workspace package. CLI-specific views stay local.

## Public agent skill

Install/sync and recovery hints select only `slax-reader`, not the repository's development skills:

```bash
npx -y skills add https://github.com/slax-lab/slax-reader/tree/dev/apps/cli/skills/slax-reader --skill slax-reader -g -y
```

This URL becomes remotely available after the migration lands on `dev`. Local discovery can be checked without installing skills using the skills tool's `add ./apps/cli/skills/slax-reader --list --skill slax-reader` command. Installing a skill is a user-authorized global operation; tests intercept it instead of changing developer agent state.

See [release setup and automation](RELEASE.md) for npm trusted publishing and GitHub Release assets.
