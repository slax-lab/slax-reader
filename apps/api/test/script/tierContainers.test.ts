import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test, vi } from 'vitest'
import { API_ROOT } from '../../script/root'

vi.mock('cloudflare:workers', () => ({ DurableObject: class {}, WorkerEntrypoint: class {}, WorkflowEntrypoint: class {} }))
vi.mock('cloudflare:workflows', () => ({ NonRetryableError: class extends Error {} }))

import { Container } from '@/decorators/di'
import type { ContextManager } from '@/utils/context'

const GENERATED = path.join(API_ROOT, 'src/di/generated')
// Every class the generated dispatch modules and the Worker's entry modules resolve at runtime.
const roots = (tier: 'core' | 'ai') => {
  const files = [
    ...fs
      .readdirSync(path.join(GENERATED, tier))
      .filter(name => name !== 'dependency.ts')
      .map(name => path.join(GENERATED, tier, name))
  ]
  const walk = (directory: string): string[] =>
    fs
      .readdirSync(directory, { withFileTypes: true })
      .flatMap(entry => (entry.isDirectory() ? walk(path.join(directory, entry.name)) : entry.name.endsWith('.ts') ? [path.join(directory, entry.name)] : []))
  files.push(...walk(path.join(API_ROOT, 'src/entry', tier)))
  const names = new Set<string>()
  for (const file of files) for (const match of fs.readFileSync(file, 'utf8').matchAll(/\.resolve(?:<[^>]*>)?\(\s*([A-Z][A-Za-z0-9_]*)\s*\)/g)) names.add(match[1])
  return [...names].sort()
}

// Registers each infrastructure token the registry would provide as an inert value, so resolving a root
// exercises only the generated wiring; a token the registry no longer provides stays unregistered.
function scope(module: { initializeInfrastructure: (ctx: ContextManager, target: Container) => void; initializeCore: () => { container: Container } }) {
  const target = module.initializeCore().container.clone()
  const recorder = new Container()
  const tokens: unknown[] = []
  recorder.register = (token: unknown) => void tokens.push(token)
  module.initializeInfrastructure({ env: {}, onCleanup: () => undefined } as unknown as ContextManager, recorder)
  for (const token of tokens) target.register(token, { useValue: {} })
  return { target, tokens }
}

const PROVIDERS = path.join(API_ROOT, 'src/di/providers')

async function rootClasses(tier: 'core' | 'ai', tokens: unknown[]) {
  const source = fs.readFileSync(path.join(GENERATED, tier, 'dependency.ts'), 'utf8')
  const classes: { name: string; value: unknown }[] = []
  const missing: string[] = []
  for (const name of roots(tier)) {
    const imported = new RegExp(`import \\{[^}]*\\b${name}\\b[^}]*\\} from '([^']+)'`).exec(source)
    if (imported) classes.push({ name, value: (await import(path.resolve(GENERATED, tier, imported[1])))[name] })
    // A provider token is satisfied by the registry, which the scope recorded.
    else if (!fs.existsSync(path.join(PROVIDERS, `${name}.ts`)) || !tokens.some(token => (token as { name?: string })?.name === name || String(token) === `Symbol(${name})`))
      missing.push(name)
  }
  return { classes, missing }
}

describe.each(['core', 'ai'] as const)('the %s registry', tier => {
  test('resolves every class its dispatch and entry modules look up', async () => {
    const module = await import(`../../src/di/generated/${tier}/dependency.ts`)
    const { target, tokens } = scope(module)
    const { classes, missing } = await rootClasses(tier, tokens)
    expect(missing).toEqual([])
    expect(classes.length).toBeGreaterThanOrEqual(tier === 'core' ? 40 : 5)
    const failures: string[] = []
    for (const { name, value } of classes) {
      try {
        target.resolve(value as never)
      } catch (error) {
        if (String(error).includes('No provider for')) failures.push(`${name}: ${error}`)
      }
    }
    expect(failures).toEqual([])
  })

  // Lazy dependencies resolve only on first use, so resolving roots cannot prove them; check every token instead.
  test('registers or provides every token its registrations resolve, including lazy ones', () => {
    const source = fs.readFileSync(path.join(GENERATED, tier, 'dependency.ts'), 'utf8')
    const registered = new Set(Array.from(source.matchAll(/container\.register\(([A-Za-z_][A-Za-z0-9_]*),/g), match => match[1]))
    const provided = new Set(Array.from(source.matchAll(/^\s*provide([A-Za-z_][A-Za-z0-9_]*),?$/gm), match => match[1]))
    const resolved = new Set(Array.from(source.matchAll(/container\.resolve\(([A-Za-z_][A-Za-z0-9_]*)\)/g), match => match[1]))
    expect(provided.size).toBeGreaterThan(0)
    expect([...resolved].filter(name => !registered.has(name) && !provided.has(name) && name !== 'DatabaseRegistry')).toEqual([])
  })

  // Without the registry, roots fail either for a missing token or for an env-bound client built without its env.
  test('fails when the infrastructure providers are not registered', async () => {
    const module = await import(`../../src/di/generated/${tier}/dependency.ts`)
    const bare = module.initializeCore().container.clone()
    const { classes } = await rootClasses(tier, [])
    const errors: string[] = []
    for (const { value } of classes) {
      try {
        bare.resolve(value as never)
      } catch (error) {
        errors.push(String(error))
      }
    }
    expect(errors.length, `resolved all ${classes.length} roots without the registry`).toBeGreaterThan(0)
  })
})
