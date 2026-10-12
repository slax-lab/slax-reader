import fs from 'node:fs/promises'
import path from 'node:path'
import { getConfigDir } from './config.js'

export function statePath(fileName: string): string {
  return path.join(getConfigDir(), fileName)
}

export async function readTextState(fileName: string): Promise<string | null> {
  try {
    const data = await fs.readFile(statePath(fileName), 'utf8')
    return data.trim()
  } catch (err) {
    if (isNotFoundError(err)) return null
    throw err
  }
}

export async function writeTextState(fileName: string, value: string): Promise<void> {
  await atomicWrite(fileName, value)
}

export async function readJsonState<T>(fileName: string): Promise<T | null> {
  const text = await readTextState(fileName)
  if (!text) return null
  return JSON.parse(text) as T
}

export async function writeJsonState(fileName: string, value: unknown): Promise<void> {
  await atomicWrite(fileName, JSON.stringify(value))
}

async function atomicWrite(fileName: string, value: string): Promise<void> {
  const target = statePath(fileName)
  const tmp = `${target}.${process.pid}.tmp`
  await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 })
  await fs.writeFile(tmp, value, { mode: 0o600 })
  await fs.rename(tmp, target)
}

function isNotFoundError(err: unknown): boolean {
  return err instanceof Error && 'code' in err && err.code === 'ENOENT'
}
