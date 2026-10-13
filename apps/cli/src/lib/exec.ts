import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export function execNpx(
  args: string[],
  options: Parameters<typeof execFileAsync>[2]
): ReturnType<typeof execFileAsync> {
  if (process.platform === 'win32') {
    return execFileAsync('cmd.exe', ['/d', '/s', '/c', 'npx.cmd', ...args], options)
  }
  return execFileAsync('npx', args, options)
}
