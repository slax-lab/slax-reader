import { API_ROOT } from '../../script/root'
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { isolatedEnvironment, ROOT } from '../../script/deploy/dev-local'

export class LocalResources {
  readonly workspace = mkdtempSync(resolve(ROOT, '.tmp-root-tooling-http-'))
  readonly emptyEnv = resolve(this.workspace, 'empty.env-file')
  readonly home = resolve(this.workspace, 'home')
  readonly env: NodeJS.ProcessEnv
  private containers: string[] = []
  private processGroups = new Set<number>()
  private interrupted = () => {
    this.cleanup()
    this.removeWorkspace()
    process.exit(130)
  }

  ownProcessGroup(pid: number) {
    this.processGroups.add(pid)
  }

  constructor() {
    mkdirSync(resolve(this.home, 'tmp'), { recursive: true })
    writeFileSync(this.emptyEnv, '')
    this.env = isolatedEnvironment(this.home, this.emptyEnv)
    process.once('SIGINT', this.interrupted)
    process.once('SIGTERM', this.interrupted)
    console.log(`Isolated artifacts: ${this.workspace}`)
  }

  command(command: string, args: string[], input?: string) {
    const result = spawnSync(command, args, { cwd: API_ROOT, env: this.env, encoding: 'utf8', input, maxBuffer: 16 * 1024 * 1024, timeout: 120000 })
    if (result.error || result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed: ${result.error ?? result.stderr ?? result.stdout}`)
    return result.stdout.trim()
  }

  async run(label: string, command: string, args: string[], extraEnv: NodeJS.ProcessEnv = {}) {
    const logfile = resolve(this.workspace, `${label}.log`)
    let output = ''
    const child = spawn(command, args, { cwd: API_ROOT, env: { ...this.env, ...extraEnv }, stdio: ['ignore', 'pipe', 'pipe'] })
    child.stdout.on('data', chunk => {
      output += chunk
      process.stdout.write(chunk)
    })
    child.stderr.on('data', chunk => {
      output += chunk
      process.stderr.write(chunk)
    })
    const timer = setTimeout(() => child.kill('SIGTERM'), 180000)
    try {
      const status = await new Promise<number>((done, reject) => {
        child.once('error', reject)
        child.once('exit', code => done(code ?? 1))
      })
      return status
    } finally {
      clearTimeout(timer)
      writeFileSync(logfile, output)
    }
  }

  async portAvailable(port: number) {
    await new Promise<void>((done, reject) => {
      const server = createServer()
      server.once('error', reject)
      server.listen(port, '127.0.0.1', () => server.close(error => (error ? reject(error) : done())))
    })
  }

  async container(image: 'postgres:17-alpine', options: { name?: string; port?: number } = {}) {
    this.command('docker', ['image', 'inspect', image, '--format', '{{.Id}}'])
    const name = options.name ?? `slax-root-tooling-pg-${this.workspace.split('-').at(-1)}`
    const existing = this.command('docker', ['ps', '-a', '--format', '{{.Names}}']).split('\n')
    if (existing.includes(name)) throw new Error(`Container ${name} already exists; refusing reuse or deletion`)
    if (options.port) await this.portAvailable(options.port)
    const id = this.command('docker', [
      'run',
      '--pull=never',
      '--detach',
      '--name',
      name,
      '--label',
      `slax.root-tooling=${this.workspace}`,
      '--publish',
      `127.0.0.1:${options.port ?? ''}:5432`,
      '--env',
      'POSTGRES_HOST_AUTH_METHOD=trust',
      image
    ])
    this.containers.push(id)
    const mapping = this.command('docker', ['port', id, '5432/tcp'])
    if (!/^127\.0\.0\.1:\d+$/.test(mapping)) throw new Error(`Unexpected Docker port mapping: ${mapping}`)
    for (let i = 0; i < 60; i++) {
      try {
        // The image's temporary init server only listens on a Unix socket. Wait for the final TCP server.
        this.command('docker', ['exec', id, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres'])
        return { id, name, port: Number(mapping.split(':')[1]) }
      } catch {
        await delay(500)
      }
    }
    throw new Error(`Container ${name} did not become ready`)
  }

  sql(containerId: string, database: string, sql: string) {
    if (!this.containers.includes(containerId)) throw new Error("Only this run's newly created containers may be accessed")
    return this.command('docker', ['exec', '-i', containerId, 'psql', '-U', 'postgres', '-d', database, '-Atq', '-v', 'ON_ERROR_STOP=1'], sql)
  }

  async migrate(label: string, databaseUrl: string, kind: 'pgsql' | 'logs') {
    const envFile = resolve(this.workspace, `${label}.env-file`)
    writeFileSync(envFile, `HYPERDRIVE_DATABASE_URL=${databaseUrl}\nLOGS_DATABASE_URL=${databaseUrl}\n`, { mode: 0o600 })
    return this.run(label, 'pnpm', ['exec', 'prisma', 'migrate', 'deploy', '--config', `prisma/${kind}.config.ts`], {
      SLAX_API_ENV_FILE: envFile
    })
  }

  removeWorkspace() {
    fs.rmSync(this.workspace, { recursive: true, force: true })
  }

  cleanup() {
    process.removeListener('SIGINT', this.interrupted)
    process.removeListener('SIGTERM', this.interrupted)
    for (const pid of this.processGroups) {
      try {
        process.kill(-pid, 'SIGKILL')
      } catch {}
    }
    this.processGroups.clear()
    for (const id of this.containers.splice(0).reverse()) {
      try {
        this.command('docker', ['rm', '--force', '--volumes', id])
        console.log(`Removed owned container ${id}`)
      } catch (error) {
        console.error(`CLEANUP FAILED: ${id}`, error)
        process.exitCode = 1
      }
    }
  }
}
