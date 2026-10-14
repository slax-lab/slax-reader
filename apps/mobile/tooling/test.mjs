import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

function discover(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? discover(path) : /\.test\.(?:ts|mjs|cjs)$/.test(entry.name) ? [path] : [];
  });
}
const files = [...discover(fileURLToPath(new URL('../tests/', import.meta.url))), fileURLToPath(new URL('../native/share/tests/plugin.test.cjs', import.meta.url))];
if (!files.length) throw new Error('No mobile verification tests were found.');
const result = spawnSync(process.execPath, ['--experimental-strip-types', '--test', ...files, ...process.argv.slice(2)], { stdio: 'inherit' });
process.exitCode = result.status ?? 1;
