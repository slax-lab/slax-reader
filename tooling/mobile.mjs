import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { constants } from 'node:os';
import { pnpmInvocation } from './pnpm-command.mjs';
import {loadMobileEnvironment} from '../apps/mobile/tooling/deploy-environment.cjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(readFileSync(new URL('../apps/mobile/package.json', import.meta.url), 'utf8'));
const args = process.argv.slice(2);
if (args[0] === '--') args.shift();
const command = args.shift();
const commands = Object.keys(manifest.scripts);
if (!command || ['help', '-h', '--help'].includes(command)) {
  console.log(`Usage: pnpm mobile -- <command> [arguments]\n\nCommands:\n  ${commands.join('\n  ')}`);
  process.exitCode = command ? 0 : 2;
} else if (!commands.includes(command)) {
  console.error(`Unknown mobile command: ${command}`);
  process.exitCode = 2;
} else {
  const configurationCommands = new Set(['dev', 'config', 'prebuild', 'prebuild:clean', 'android', 'ios', 'pods', 'build:android', 'build:ios', 'archive:ios', 'export:ios', 'upload:ios']);
  const release = args.some((value, index) => value === '--release' || ['--configuration', '--variant'].includes(value) && String(args[index + 1]).toLowerCase() === 'release');
  const development = ['dev', 'ios', 'android'].includes(command) && !release;
  const environment = configurationCommands.has(command)
    ? loadMobileEnvironment({development}).environment
    : {...process.env, SLAX_MOBILE_NO_LOCAL_CONFIG: '1'};
  const invocation = pnpmInvocation(['--filter', manifest.name, 'run', command, ...args]);
  const grouped = process.platform !== 'win32' && process.env.SLAX_APP_INHERIT_PROCESS_GROUP !== '1';
  const child = spawn(invocation.program, invocation.args, { cwd: root, stdio: 'inherit', env: {...environment, EXPO_NO_DOTENV: '1'}, detached: grouped });
  let interrupted;
  const stop = signal => {
    interrupted = signal;
    if (!child.pid) return;
    try { grouped ? process.kill(-child.pid, signal) : child.kill(signal); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
  };
  const interrupt = () => stop('SIGINT');
  const terminate = () => stop('SIGTERM');
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', terminate);
  child.on('error', error => { console.error(`Mobile command failed: ${error.message}`); process.exitCode = 1; });
  child.on('close', (code, signal) => {
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', terminate);
    process.exitCode = interrupted || signal ? 128 + (constants.signals[interrupted || signal] ?? 1) : code ?? 1;
  });
}
