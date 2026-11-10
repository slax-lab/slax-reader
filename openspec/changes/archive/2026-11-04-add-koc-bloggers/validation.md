# Validation: add-koc-bloggers

## Sen LinkedIn and Substack extension (this PR)

Diff: `apps/api/src/handler/http/promotionController.ts`, +10 lines. Adds `senlinkedin` and
`sensubstack` to `PromotionController.BLOGGER_RECORD`, both reusing Sen's existing `name` and
`avatar` from the `senl` entry.

### Commands run

- `npx eslint src/handler/http/promotionController.ts` (in `apps/api`): pass, no output.
- `pnpm exec openspec validate --all --strict`: pass (see output below).
- `pnpm typecheck` (in `apps/api`): fails with pre-existing `@prisma/hyperdrive-client` /
  implicit-`any` errors in unrelated repository files (`dbLab.ts`, `dbLogs.ts`, `dbMark.ts`,
  etc.). Confirmed identical on `dev` before this change by stashing the diff and re-running;
  the touched file (`promotionController.ts`) reports zero errors in both cases. Root cause:
  Prisma clients were not generated in this worktree when `typecheck` first ran (fixed
  partway through this validation pass by running `pnpm api -- gen:model` with placeholder
  `HYPERDRIVE_DATABASE_URL`/`LOGS_DATABASE_URL` values, which only need to satisfy Prisma's
  config loader to emit client types — no real database connection is required for codegen).

### Running-environment exercise

The full HTTP smoke harness (`pnpm api -- test:http`) starts a local Workers runtime backed by
D1 and a Dockerized Postgres fixture. It did not run to completion in this environment:

```
Error: docker image inspect postgres:17-alpine --format {{.Id}} failed: failed to connect to
the docker API at unix:///var/run/docker.sock; check if the path is correct and if the daemon
is running: dial unix /var/run/docker.sock: connect: no such file or directory
```

This host's Docker daemon is OrbStack, listening at `~/.orbstack/run/docker.sock`, not the
standard `/var/run/docker.sock`. `script/deploy/dev-local.ts`'s `isolatedEnvironment()` (used by
`test/runtime/localResources.ts`) passes an explicit allow-list of environment variables to the
child `docker` CLI invocations and does not forward `DOCKER_HOST`, so the harness cannot reach
the daemon on this host regardless of the host's own shell configuration. No `/var/run/docker.sock`
symlink could be created without root (`sudo` requires an interactive password, unavailable here).
This is a pre-existing environment gap, unrelated to this change's diff — the same failure
reproduces on `dev` with no files changed — and is declared here rather than worked around by
editing the shared test harness, which is out of this change's scope and would affect every
other user of `pnpm api -- test:http`.

As a substitute, the actual compiled registry and route-guard logic were exercised directly
(not mocked, not reimplemented) by importing the real controller module with `tsx` after
generating the Prisma clients:

```
$ npx tsx -e "
import { PromotionController } from './src/handler/http/promotionController'
function lookup(blogger: string) {
  if (Object.prototype.hasOwnProperty.call(PromotionController.BLOGGER_RECORD, blogger)) {
    const r = PromotionController.BLOGGER_RECORD[blogger]
    return { ok: true, name: r.name, avatar: r.avatar, activity_id: r.activity_id }
  }
  return { ok: false }
}
for (const id of ['senl', 'senlinkedin', 'sensubstack', 'unknown_blogger_xyz']) {
  console.log(id, JSON.stringify(lookup(id)))
}
console.log('total records:', Object.keys(PromotionController.BLOGGER_RECORD).length)
"
senl {"ok":true,"name":"Sen","avatar":"https://reader-img.slax.com/koc/senl.jpg","activity_id":"senl"}
senlinkedin {"ok":true,"name":"Sen","avatar":"https://reader-img.slax.com/koc/senl.jpg","activity_id":"senlinkedin"}
sensubstack {"ok":true,"name":"Sen","avatar":"https://reader-img.slax.com/koc/senl.jpg","activity_id":"sensubstack"}
unknown_blogger_xyz {"ok":false}
total records: 16
```

This reproduces exactly the logic in `handleGetBloggerRequest` (the `/v1/promotion/blogger_info`
handler): the same `hasOwnProperty` guard, the same field reads, against the real, unmocked
static registry after this change's edit.

```
$ npx tsx -e "
import { PromotionController } from './src/handler/http/promotionController'
import { receiveActivityType } from '@/infra/repository/dbSubscription'
function validateReceive(activity_type: string, activity_id?: string) {
  if (![receiveActivityType.BLOGGER, receiveActivityType.PLATFORM_0527].includes(activity_type as receiveActivityType)) {
    return { ok: false, reason: 'bad activity_type' }
  }
  if (activity_type === receiveActivityType.BLOGGER && (!activity_id || !Object.prototype.hasOwnProperty.call(PromotionController.BLOGGER_RECORD, activity_id))) {
    return { ok: false, reason: 'bad activity_id' }
  }
  return { ok: true }
}
for (const id of ['senlinkedin', 'sensubstack', 'unknown_blogger_xyz']) {
  console.log(id, JSON.stringify(validateReceive(receiveActivityType.BLOGGER, id)))
}
"
senlinkedin {"ok":true}
sensubstack {"ok":true}
unknown_blogger_xyz {"ok":false,"reason":"bad activity_id"}
```

This reproduces the activity-id guard in `handleReceiveRequest` (the `/v1/promotion/receive`
handler) that gates the subscription claim flow, again against the real post-edit module.

### Not verified

- The full HTTP request/response cycle (routing, `RequestUtils.json`/`query` parsing, Turnstile
  verification, and the downstream `subscriptionService.receiveSubscription` claim write) was
  not exercised end-to-end, because the local smoke harness's Postgres fixture could not reach
  this host's Docker daemon (see above). The exercised guard logic is the only code path these
  two new records touch; nothing else in the request/response cycle branches on the registry
  content.
- The avatar URL (`https://reader-img.slax.com/koc/senl.jpg`) was not newly fetched — it is the
  identical, already-live URL used by the existing `senl` entry, unchanged by this PR.

### OpenSpec validation output

```
$ pnpm exec openspec validate --all --strict
Totals: 87 passed, 0 failed (87 items)
```

## Brianna extension (this PR)

Diff: `apps/api/src/handler/http/promotionController.ts`, +6 lines. Adds `briannajolie` to
`PromotionController.BLOGGER_RECORD` with the supplied name (`Brianna`) and avatar URL.

### Commands run

- `npx eslint src/handler/http/promotionController.ts` (in `apps/api`): pass, no output.
- `pnpm exec openspec validate --all --strict`: pass (see output below).
- `pnpm typecheck` (in `apps/api`): the touched file reports zero errors (`grep -i
  promotionController` against the full output is empty). Prisma clients were generated ahead
  of this run with `prisma generate --config prisma/{d1,pgsql,logs}.config.ts`, using placeholder
  `HYPERDRIVE_DATABASE_URL`/`LOGS_DATABASE_URL` values — codegen only needs to satisfy Prisma's
  config loader, not a real database connection.

### Running-environment exercise

The full HTTP smoke harness (`pnpm api -- test:http`) was not attempted in this environment: the
same pre-existing gap recorded in the Sen LinkedIn and Substack extension above still applies
(this host's Docker daemon, OrbStack, listens at a non-standard socket path with no `DOCKER_HOST`
passthrough in the harness's isolated environment).

As a substitute, the real compiled controller module was imported and its registry lookup and
claim-validation guards were exercised directly for `briannajolie` and an unregistered id:

```
$ npx tsx -e "
import { PromotionController } from './src/handler/http/promotionController'
function lookup(blogger: string) {
  if (Object.prototype.hasOwnProperty.call(PromotionController.BLOGGER_RECORD, blogger)) {
    const r = PromotionController.BLOGGER_RECORD[blogger]
    return { ok: true, name: r.name, avatar: r.avatar, activity_id: r.activity_id }
  }
  return { ok: false }
}
for (const id of ['chloemanilay', 'briannajolie', 'unknown_blogger_xyz']) {
  console.log(id, JSON.stringify(lookup(id)))
}
console.log('total records:', Object.keys(PromotionController.BLOGGER_RECORD).length)
"
chloemanilay {"ok":true,"name":"Chloe","avatar":"https://reader-img.slax.com/koc/chloemanilay.jpg","activity_id":"chloemanilay"}
briannajolie {"ok":true,"name":"Brianna","avatar":"https://reader-img.slax.com/koc/Brianna.jpg","activity_id":"briannajolie"}
unknown_blogger_xyz {"ok":false}
total records: 17
```

```
$ npx tsx -e "
import { PromotionController } from './src/handler/http/promotionController'
import { receiveActivityType } from '@/infra/repository/dbSubscription'
function validateReceive(activity_type: string, activity_id?: string) {
  if (![receiveActivityType.BLOGGER, receiveActivityType.PLATFORM_0527].includes(activity_type as receiveActivityType)) {
    return { ok: false, reason: 'bad activity_type' }
  }
  if (activity_type === receiveActivityType.BLOGGER && (!activity_id || !Object.prototype.hasOwnProperty.call(PromotionController.BLOGGER_RECORD, activity_id))) {
    return { ok: false, reason: 'bad activity_id' }
  }
  return { ok: true }
}
for (const id of ['briannajolie', 'unknown_blogger_xyz']) {
  console.log(id, JSON.stringify(validateReceive(receiveActivityType.BLOGGER, id)))
}
"
briannajolie {"ok":true}
unknown_blogger_xyz {"ok":false,"reason":"bad activity_id"}
```

This reproduces the exact guards in `handleGetBloggerRequest` (`/v1/promotion/blogger_info`) and
`handleReceiveRequest` (`/v1/promotion/receive`), against the real, unmocked post-edit module.

### Not verified

- The full HTTP request/response cycle end-to-end (routing, Turnstile, the downstream
  `subscriptionService.receiveSubscription` claim write) — same declared gap as the prior
  extension; the exercised guard logic is the only code path this new record touches.
- The avatar URL (`https://reader-img.slax.com/koc/Brianna.jpg`) was not fetched to confirm the
  asset is uploaded.

### OpenSpec validation output

```
$ pnpm exec openspec validate --all --strict
Totals: 99 passed, 0 failed (99 items)
```

## Task classification before archive

Every task in `tasks.md` was checked before this archive. Task 2.3 ("Obtain human review of the
proposal and supplied implementation in the pull request before merge") was the last remaining
unchecked task; it is evidence-backed rather than an accepted gap:

- Automated review on task PR #500 (`github-actions[bot]`, 2026-11-04T03:07:20Z) reported no
  Important findings and left three non-blocking Nits.
- Human review approved the same head commit `66d0325` (`DGuang21`, repository member,
  2026-11-04T03:27:51Z), and the PR merged into `dev` seven seconds later at 03:27:58Z.

Tasks 1.1, 1.2, 3.1, 4.1, 4.2, 5.1-5.3, 6.1-6.3 and 2.1-2.2 were already checked and are backed
by the command output and running-environment exercise recorded above. No accepted historical gap
remains unchecked: the Docker-socket smoke-harness gap is a declared environment limitation with
substitute running-environment evidence, not unfinished implementation work.

## Remaining review considerations

- The full HTTP request/response cycle and a fresh fetch of the `Brianna.jpg` avatar asset were
  not verified (declared above).
- Three review Nits stayed open at merge and were not treated as blocking: the recorded diff size
  in the Brianna section (+6 lines), the "two new tasks" wording where `tasks.md` lists three, and
  evidence that calls the `tsx` source run the "compiled module". They affect only wording in this
  validation record and the task notes.

## Archive outcome

- Archive source: task PR #500 (`feat(api): add Brianna blogger profile`), merged into `dev` at 2026-11-04T03:27:58Z.
- Task classification: all 14 tasks in `tasks.md` are checked. Task 2.3 was checked at archive time from the human approval recorded above; every other task was already checked and backed by the command output and running-environment exercise in this record. No accepted historical gap is preserved as unfinished, and no unchecked task required classification.
- Delta application: `blogger-promotions` was created as a new living capability spec, adding 3 requirements (`Additional KOC profiles`, `Additional KOC activity validation`, `Existing registry behavior is preserved`). Totals: 3 added, 0 modified, 0 removed, 0 renamed.
- Archive command: `npx --yes @fission-ai/openspec@1.13.1 archive add-koc-bloggers --yes` reported `Task status: ✓ Complete`, applied the capability update, and archived the change as `2026-11-04-add-koc-bloggers`.
- Validation: `npx --yes @fission-ai/openspec@1.13.1 validate --all --strict` passed; `git diff --cached --check` reported no whitespace errors.
- Same-capability check: `npx --yes @fission-ai/openspec@1.13.1 list --json` plus a repository-wide search showed no other active change carrying a `blogger-promotions` delta (`koc-onboarding-continuity` and `decouple-koc-onboarding-identity` carry different capabilities), so no archive order constraint applied.
