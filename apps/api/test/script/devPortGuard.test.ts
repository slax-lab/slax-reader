import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'
import { afterEach, describe, expect, test } from 'vitest'
import { devPortInUseMessage, devPortOccupied } from '../../script/deploy/deploy'

const servers: net.Server[] = []
const children: ChildProcess[] = []
const directories: string[] = []
afterEach(async () => {
  for (const child of children.splice(0)) child.kill('SIGKILL')
  await Promise.all(servers.splice(0).map(server => new Promise(resolve => server.close(() => resolve(undefined)))))
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true })
})

const listen = (server: net.Server, port: number): Promise<number> =>
  new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => resolve((server.address() as net.AddressInfo).port))
  })

const freePort = async (): Promise<number> => {
  const probe = net.createServer()
  const port = await listen(probe, 0)
  await new Promise(resolve => probe.close(() => resolve(undefined)))
  return port
}

// ps reports the child's argv, so the listener is spawned from a script whose
// path names it like a real Wrangler runtime process.
const listenAsFakeWorkerd = async (): Promise<{ port: number; pid: number }> => {
  const port = await freePort()
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'slax-port-guard-'))
  directories.push(directory)
  const script = path.join(directory, 'fake-workerd.cjs')
  fs.writeFileSync(script, `require('net').createServer().listen(${port}, '127.0.0.1')\n`)
  const child = spawn(process.execPath, [script], { stdio: 'ignore' })
  children.push(child)
  for (let attempt = 0; attempt < 50; attempt++) {
    if (await devPortOccupied(port)) return { port, pid: child.pid! }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error('fake workerd never started listening')
}

describe('dev port guard', () => {
  test('reports a free port as free and an occupied one as occupied', async () => {
    const port = await freePort()
    expect(await devPortOccupied(port)).toBe(false)
    const server = net.createServer()
    servers.push(server)
    await listen(server, port)
    expect(await devPortOccupied(port)).toBe(true)
  })

  test('classifies an unrelated listener as not a Slax dev session', async () => {
    const server = net.createServer()
    servers.push(server)
    const port = await listen(server, 0)
    const message = devPortInUseMessage(port)
    expect(message).toContain(`Error: 127.0.0.1:${port} is already in use by PID ${process.pid} (not a Slax dev session).`)
    expect(message).toContain('Stop that process or free the port, then retry.')
  })

  test('classifies a wrangler/workerd listener as another dev session', async () => {
    const { port, pid } = await listenAsFakeWorkerd()
    const message = devPortInUseMessage(port)
    expect(message).toContain('Error: `pnpm api -- dev` is already running on this machine.')
    expect(message).toContain(`Another instance is listening on 127.0.0.1:${port} (PID ${pid}).`)
    expect(message).toContain(`kill ${pid}, then retry.`)
  })

  test('falls back to a generic message when the listener cannot be identified', async () => {
    // A free port exercises the path where lsof finds no listener to identify.
    const port = await freePort()
    const message = devPortInUseMessage(port)
    expect(message).toBe(`Error: 127.0.0.1:${port} is already in use.\nOnly one local API dev session can run at a time. Free the port, then retry.`)
  })
})
