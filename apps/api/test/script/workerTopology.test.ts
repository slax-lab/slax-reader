import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import ts from 'typescript'
import { API_ROOT, ROOT } from '../../script/root'
import { RUNTIME_KEYS } from '../../script/deploy/runtimeKeys'

// Builds every Worker with the published configuration (minified, offline) and inspects which
// modules reach each bundle, so a stray import fails here before it reaches a deploy.
type Target = 'edge' | 'core' | 'ai' | 'objects' | 'vector' | 'browser'
const TARGETS: Target[] = ['edge', 'core', 'ai', 'objects', 'vector', 'browser']
const BIN = path.join(API_ROOT, 'node_modules/.bin')

let directory: string
const modules: Partial<Record<Target, string[]>> = {}
const configs: Partial<Record<Target, Record<string, any>>> = {}
const assets: Partial<Record<Target, string[]>> = {}

beforeAll(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'worker-topology-'))
  const result = spawnSync(path.join(BIN, 'tsx'), ['--tsconfig', path.join(API_ROOT, 'tsconfig.json'), 'script/deploy/build.ts'], {
    cwd: API_ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${BIN}${path.delimiter}${process.env.PATH}`,
      SLAX_API_CONFIG: path.join(ROOT, 'deploy/cloudflare/api.toml.example'),
      SLAX_API_GENERATED_DIR: directory
    },
    timeout: 240_000
  })
  expect(result.status, result.stderr || result.stdout).toBe(0)
  for (const target of TARGETS) {
    const meta = JSON.parse(fs.readFileSync(path.join(directory, `bundle-${target}.meta.json`), 'utf8')) as {
      outputs: Record<string, { inputs: Record<string, { bytesInOutput: number }> }>
    }
    modules[target] = Object.entries(meta.outputs)
      .filter(([name]) => !name.endsWith('.map'))
      .flatMap(([, output]) => Object.entries(output.inputs).filter(([, input]) => input.bytesInOutput > 0))
      .map(([name]) => name.replace(/^.*node_modules\//, 'node_modules/'))
    assets[target] = fs.readdirSync(path.join(directory, `bundle-${target}`))
  }
}, 300_000)

afterAll(() => {
  if (directory) fs.rmSync(directory, { recursive: true, force: true })
})

const matching = (target: Target, pattern: RegExp) => modules[target]!.filter(name => pattern.test(name))

const DO_IMPLEMENTATIONS = /src\/utils\/hybridSearch\/jieba\.ts|src\/infra\/message\/websocket\.ts|src\/entry\/objects\/|jieba-wasm|jieba_rs|@cloudflare\/puppeteer/
const MCP = /node_modules\/(agents|@modelcontextprotocol)\//
const CORE_ONLY =
  /src\/di\/generated\/core\/|src\/entry\/core\/|src\/domain\/(crawl|import|passkey|telegram|newsletter\w*|subscription\w*|youtubeArticle\w*|podcast\w*)\.ts|src\/infra\/external\/stripe\.ts|node_modules\/(stripe|grammy|unpdf|@simplewebauthn|mailsplit)\//

describe('each Worker bundles only its own code', () => {
  test('Edge carries no registry, database client, job, Durable Object or WebAssembly', () => {
    expect(assets.edge!.filter(name => name.endsWith('.wasm'))).toEqual([])
    expect(
      matching('edge', /node_modules\/(@prisma|\.prisma|pg)\/|src\/di\/generated\/|src\/entry\/(core|ai|objects|vector)\/|src\/handler\/(queue|cron)\/|Workflow\.ts$/)
    ).toEqual([])
    expect(matching('edge', DO_IMPLEMENTATIONS)).toEqual([])
    expect(matching('edge', /src\/entry\/retired\.ts/)).toEqual(['src/entry/retired.ts'])
  })

  test.each(['core', 'ai'] as const)('%s carries no stateless Durable Object implementation or MCP library', target => {
    expect(assets[target]!.filter(name => /jieba/.test(name))).toEqual([])
    expect(matching(target, DO_IMPLEMENTATIONS)).toEqual([])
    expect(matching(target, MCP)).toEqual([])
  })

  test('AI carries none of Core router, jobs, capture, import, Passkey, Telegram, Stripe, newsletter or PDF-text code', () => {
    expect(matching('ai', CORE_ONLY)).toEqual([])
    expect(matching('ai', /src\/di\/generated\/ai\/aiRouter\.ts/)).toHaveLength(1)
  })

  test('Core keeps its jobs and serves no AI router', () => {
    expect(matching('core', /src\/di\/generated\/ai\//)).toEqual([])
    for (const owned of [
      'src/di/generated/core/consumer.ts',
      'src/di/generated/core/cronjob.ts',
      'src/entry/core/workflows/crawlWorkflow.ts',
      'src/entry/core/vectorPreferenceObject.ts'
    ])
      expect(modules.core, owned).toContain(owned)
  })

  test('Vector carries only the semantic step: no registry, router, database client, Durable Object or WebAssembly', () => {
    expect(assets.vector!.filter(name => name.endsWith('.wasm'))).toEqual([])
    expect(matching('vector', /node_modules\/(@prisma|\.prisma|pg)\/|src\/di\/|src\/handler\/|src\/entry\/(core|ai|edge|objects)\/|Workflow\.ts$/)).toEqual([])
    expect(matching('vector', DO_IMPLEMENTATIONS)).toEqual([])
    for (const owned of ['src/entry/vector/index.ts', 'src/domain/semanticCandidates.ts', 'src/utils/embeddingMean.ts']) expect(modules.vector, owned).toContain(owned)
  })

  test('Objects carries its three classes and no registry, router or job handler', () => {
    expect(matching('objects', /src\/di\/generated\/|src\/handler\/|src\/entry\/(core|ai|edge)\/|Workflow\.ts$/)).toEqual([])
    expect(assets.objects!.some(name => /jieba.*\.wasm$/.test(name))).toBe(true)
    for (const owned of ['src/utils/hybridSearch/jieba.ts', 'src/infra/message/websocket.ts', 'src/entry/objects/screenshotBrowser.ts'])
      expect(modules.objects, owned).toContain(owned)
  })
})

// Env names a Worker's bundled source reads, from the same declarations the Env type uses.
const envText = fs.readFileSync(path.join(API_ROOT, 'worker-configuration.d.ts'), 'utf8').split('// Begin runtime types')[0]
const declared = new Map([...envText.matchAll(/^\s+([A-Za-z][A-Za-z0-9_]*)\??:\s*([^\n]+)/gm)].map(match => [match[1], match[2].trim()]))
const STRING = /^string\b/
function envReads(target: Target): Set<string> {
  const found = new Set<string>()
  for (const file of modules[target]!.filter(name => /^src\/.*\.ts$/.test(name))) {
    const source = ts.createSourceFile(file, fs.readFileSync(path.join(API_ROOT, file), 'utf8'), ts.ScriptTarget.Latest, true)
    const envLike = (node: ts.Node) => /(^|\.)env[!?]?$|^env$|Env$/.test(node.getText(source))
    const visit = (node: ts.Node) => {
      if (ts.isPropertyAccessExpression(node) && declared.has(node.name.text) && envLike(node.expression)) found.add(node.name.text)
      if (ts.isVariableDeclaration(node) && node.initializer && ts.isObjectBindingPattern(node.name) && envLike(node.initializer))
        for (const element of node.name.elements) {
          const key = element.propertyName ?? element.name
          if (ts.isIdentifier(key) && declared.has(key.text)) found.add(key.text)
        }
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
  return found
}

describe('runtime values follow the code', () => {
  test.each(['edge', 'core', 'ai', 'objects', 'vector'] as const)('RUNTIME_KEYS.%s lists exactly the string values its bundle reads', target => {
    const strings = [...envReads(target)].filter(name => STRING.test(declared.get(name)!) && name !== 'API_QUEUE_CHANNELS').sort()
    expect([...RUNTIME_KEYS[target]].sort(), 'update script/deploy/runtimeKeys.ts so the transition and release checks cover it').toEqual(strings)
  })
})
