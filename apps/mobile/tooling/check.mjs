import { spawnSync } from 'node:child_process';
import { pnpmInvocation } from '../../../tooling/pnpm-command.mjs';
import {fileURLToPath} from 'node:url';

for (const path of ['../assets/verify-baseline.mjs', '../fixtures/verify-fixtures.mjs', '../src/rss/controller.verify.mjs']) {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL(path, import.meta.url))], {stdio: 'inherit'});
  if (result.status !== 0) process.exit(result.status ?? 1);
}

for (const command of ['typecheck', 'test']) {
  const invocation = pnpmInvocation(['--filter', '@apps/slax-reader-mobile', 'run', command]);
  const result = spawnSync(invocation.program, invocation.args, { stdio: 'inherit' });
  if (result.status !== 0) { process.exitCode = result.status ?? 1; break; }
}
