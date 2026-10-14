import { isAbsolute } from 'node:path'

// Windows cannot spawn a .cmd shim with shell:false. Reuse the pnpm entrypoint
// supplied by `pnpm run` instead, keeping user arguments out of a shell.
export function pnpmInvocation(args, { platform = process.platform, env = process.env, execPath = process.execPath } = {}) {
  if (platform !== 'win32') return { program: 'pnpm', args }
  const cli = env.npm_execpath
  if (cli && isAbsolute(cli)) {
    if (/\.(?:cjs|mjs|js)$/i.test(cli)) return { program: execPath, args: [cli, ...args] }
    if (/\.exe$/i.test(cli)) return { program: cli, args }
  }
  throw new Error('On Windows, run this command through pnpm (for example: pnpm web -- dev), or use WSL2.')
}
