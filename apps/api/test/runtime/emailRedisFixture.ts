import { execFile, spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { promisify } from 'node:util'

const exec = promisify(execFile)

function encode(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(encode)
  return typeof value === 'string' ? Buffer.from(value).toString('base64') : value
}

export async function startEmailRedisFixture() {
  const directory = await mkdtemp(join(tmpdir(), 'slax-mail-smoke-'))
  const socket = join(directory, 'redis.sock')
  const child = spawn('redis-server', ['--port', '0', '--unixsocket', socket, '--dir', directory, '--save', '', '--appendonly', 'no'], { stdio: 'ignore' })
  const redis = async (args: unknown[]) => {
    const { stdout } = await exec('redis-cli', ['-s', socket, '--json', ...args.map(String)])
    return { result: encode(JSON.parse(stdout)) }
  }
  const server = createServer(async (request, response) => {
    try {
      let data = ''
      for await (const chunk of request) data += chunk
      const command = JSON.parse(data)
      const result = request.url === '/pipeline' ? await Promise.all(command.map(redis)) : await redis(command)
      response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(result))
    } catch {
      response.writeHead(500).end()
    }
  })
  const dispose = async () => {
    if (server.listening) await new Promise<void>((done, reject) => server.close(error => (error ? reject(error) : done())))
    if (child.kill()) await once(child, 'exit')
    await rm(directory, { recursive: true, force: true })
  }
  try {
    await once(child, 'spawn')
    for (let i = 0; i < 20; i++) {
      try {
        await redis(['PING'])
        break
      } catch (error) {
        if (i === 19) throw error
        await delay(50)
      }
    }
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Redis REST fixture has no TCP address')
    return { url: `http://127.0.0.1:${address.port}`, dispose }
  } catch (error) {
    await dispose()
    throw error
  }
}
