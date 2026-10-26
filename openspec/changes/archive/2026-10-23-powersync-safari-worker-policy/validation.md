# Validation

## Automated results

- Before implementation, the plugin-boundary regression failed for iPhone, iPad, iPod, Android, and desktop Safari: the actual constructor options had `enableMultiTabs: true` instead of `false`. Eligible desktop and unavailable-SharedWorker cases passed.
- After implementation, `pnpm --filter @apps/slax-reader-dweb exec vitest run tests/unit/local-first` passed 51 tests across 6 files. The two development-only cases are intentionally skipped in the normal production-transform run.
- The development-transform run below passed both development cases; the seven production cases were intentionally skipped.
- The full Web suite passed 2,043 tests across 191 files; 3 tests / 1 file were skipped, including the development-only cases above.
- Web typecheck, lint for all changed source/tests, `git diff --check`, and `openspec validate --all --strict` passed. OpenSpec validated 39 items with zero failures.
- An independent read-only review completed the Bugs, Security, and Compliance passes against `powersync-safari-worker-policy`, with no Important findings or Nits. Real-device latency remains outside the automated evidence above.

The fresh worktree initially needed `pnpm --filter @apps/slax-reader-dweb type` to generate Nuxt types. A run without public environment values failed two unrelated `userLocaleFallback.spec.ts` cases (`optionsBaseUrl is not a function` and `finish is not a function`), and typecheck reported missing-runtime-config types. Both were resolved by supplying non-secret test values to the checking processes; no secret files were read or copied. Typecheck and the full test script must run sequentially because their pre-scripts both rebuild and clean the selection package output.

Run the full suite and typecheck separately with this environment prefix:

```sh
PUBLIC_BASE_URL=https://reader.test AUTH_BASE_URL=https://auth.test COOKIE_DOMAIN=reader.test COOKIE_TOKEN_NAME=slax-token SHARE_BASE_URL=https://reader.test DWEB_API_BASE_URL=https://api.test GOOGLE_OAUTH_CLIENT_ID=test-client pnpm --filter @apps/slax-reader-dweb test
PUBLIC_BASE_URL=https://reader.test AUTH_BASE_URL=https://auth.test COOKIE_DOMAIN=reader.test COOKIE_TOKEN_NAME=slax-token SHARE_BASE_URL=https://reader.test DWEB_API_BASE_URL=https://api.test GOOGLE_OAUTH_CLIENT_ID=test-client pnpm --filter @apps/slax-reader-dweb typecheck
```

Run the development selection cases from `apps/web`:

```sh
node --input-type=module <<'JS'
import { startVitest } from 'vitest/node';
const ctx = await startVitest(
  'test',
  ['tests/unit/local-first/powersync-worker-selection.spec.ts'],
  { run: true },
  { define: { 'import.meta.dev': 'true' } }
);
await ctx.close();
JS
```

## Device validation limitation and checklist

No iPhone Safari session running this worktree's production build was available during implementation. Automated tests validate selection and recovery using a mocked database boundary; they do not measure Worker startup or incremental synchronization on a real iPhone. No deployment or measured latency fix is claimed.

After a separately authorized deployment or production-mode preview:

1. Close other reader tabs on the iPhone, open the new build, and keep it in the foreground. Use a production-mode build: development intentionally uses the main thread.
2. In Safari's console, confirm the first `recovery attempt started` reports `mode: "dedicated"`, followed by `database ready` in the same mode. There must be no preceding shared attempt or eight-second shared timeout.
3. With an existing database and the same account, confirm the existing bookmarks remain and the policy change does not produce a database-clearing log.
4. Save a bookmark from another device. Record its save time and appearance time on the foreground iPhone. Repeat after returning from the background and record that case separately.
5. In an eligible desktop Chrome/Edge/Firefox session, confirm the initial mode remains `shared` and check remote bookmark appearance.
6. If dedicated initialization or synchronization still fails, capture recovery/connection logs and the failed script URL/status. Treat remaining CORS or latency symptoms as further investigation rather than evidence that this mode-selection change fixed them.
