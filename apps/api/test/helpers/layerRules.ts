import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

export const API_DIR = fileURLToPath(new URL('../..', import.meta.url))

export const LAYERS = ['entry', 'di', 'handler', 'middleware', 'domain', 'infra', 'utils', 'const', 'decorators'] as const
export type Layer = (typeof LAYERS)[number]

// entry and di compose the application; handler/middleware sit on domain; domain orchestrates infra;
// infra is the only persistence and external-I/O layer; utils, const and decorators are shared leaves.
export const ALLOWED: Record<Layer, readonly Layer[]> = {
  entry: ['di', 'handler', 'middleware', 'domain', 'infra', 'utils', 'const', 'decorators'],
  di: ['handler', 'middleware', 'domain', 'infra', 'utils', 'const', 'decorators'],
  handler: ['middleware', 'domain', 'utils', 'const', 'decorators'],
  middleware: ['utils', 'const', 'decorators'],
  domain: ['infra', 'utils', 'const', 'decorators'],
  infra: ['utils', 'const', 'decorators'],
  utils: ['const', 'decorators'],
  const: [],
  decorators: []
}

export const IO_MODULES = [
  '@prisma/client',
  '@prisma/hyperdrive-client',
  '@prisma/logs-client',
  '@prisma/adapter-d1',
  '@prisma/adapter-pg',
  'pg',
  '@upstash/redis',
  'ioredis',
  'redis',
  'openai',
  'stripe',
  '@google/genai',
  'grammy',
  'cloudflare',
  '@cloudflare/puppeteer',
  'cloudflare:sockets',
  'node:http',
  'node:https',
  'node:net',
  'node:tls',
  'http',
  'https',
  'net',
  'tls'
]
const IO_GLOBALS = new Set(['WebSocket', 'EventSource', 'XMLHttpRequest'])
const PRISMA_RAW = new Set(['$queryRaw', '$executeRaw', '$queryRawUnsafe', '$executeRawUnsafe', '$transaction'])
const PRISMA_OPS = new Set([
  'findMany',
  'findFirst',
  'findUnique',
  'findFirstOrThrow',
  'findUniqueOrThrow',
  'create',
  'createMany',
  'createManyAndReturn',
  'update',
  'updateMany',
  'upsert',
  'delete',
  'deleteMany',
  'count',
  'aggregate',
  'groupBy'
])
const BINDING_TYPES =
  /^(D1Database|KVNamespace|R2Bucket|Vectorize|VectorizeIndex|Queue|Workflow|Hyperdrive|DurableObjectNamespace|Fetcher|Service|Ai|BrowserRun|RateLimit)\b|cloudflare:pipelines/
const SQL = /^(SELECT\s[\s\S]*\sFROM\s|INSERT\s+INTO\s|UPDATE\s+\S+\s+SET\s|DELETE\s+FROM\s|WITH\s+\S+\s+AS\s)/

// di is the composition root that builds database clients from bindings.
const IO_EXEMPT: readonly Layer[] = ['infra', 'di']
// entry is the transport layer: it may forward a request to another Worker or Durable Object, but not use storage or platform services.
const FORWARDING = /^(Service|Fetcher|DurableObjectNamespace)\b/
// Only composition roots and infra itself may construct infra classes; everyone else receives them by injection.
const CONSTRUCTS_INFRA: readonly Layer[] = ['infra', 'di', 'entry']

export type Rule = 'layer-import' | 'io-module' | 'io-fetch' | 'io-global' | 'env-binding' | 'prisma' | 'raw-sql' | 'infra-construct'
export interface Violation {
  rule: Rule
  file: string
  detail: string
  line: number
  note?: string
}
export interface Context {
  bindings: ReadonlyMap<string, string>
  models: ReadonlySet<string>
}

export function layerOf(file: string): Layer | undefined {
  const [root, top] = file.split('/')
  if (root !== 'src') return undefined
  return (LAYERS as readonly string[]).includes(top) ? (top as Layer) : undefined
}

function targetOf(file: string, specifier: string): string | undefined {
  if (specifier.startsWith('@/')) return path.posix.join('src', specifier.slice(2))
  if (specifier.startsWith('.')) return path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier))
  return undefined
}

function ioModule(specifier: string) {
  return IO_MODULES.find(name => specifier === name || specifier.startsWith(`${name}/`))
}

const envLike = (node: ts.Expression, source: ts.SourceFile) => /(^|\.)env[!?]?$/.test(node.getText(source))

function typeOnly(node: ts.ImportDeclaration) {
  const clause = node.importClause
  if (!clause) return false
  if (clause.isTypeOnly) return true
  const named = clause.namedBindings
  return !clause.name && !!named && ts.isNamedImports(named) && named.elements.length > 0 && named.elements.every(element => element.isTypeOnly)
}

export function analyzeSource(file: string, text: string, context: Context): Violation[] {
  const layer = layerOf(file)
  if (!layer) throw new Error(`${file} is outside the known layers: ${LAYERS.join(', ')}`)
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const found: Violation[] = []
  const add = (rule: Rule, detail: string, node: ts.Node, note?: string) =>
    found.push({ rule, file, detail, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, ...(note ? { note } : {}) })
  const io = !IO_EXEMPT.includes(layer)
  const infraNames = new Set<string>()
  const binding = (name: string) => context.bindings.has(name) && !(layer === 'entry' && FORWARDING.test(context.bindings.get(name)!))

  const reference = (specifier: string, node: ts.Node, isType: boolean) => {
    const target = targetOf(file, specifier)
    if (target) {
      const to = layerOf(target)
      if (!to) add('layer-import', `${layer} -> unknown ${specifier}`, node)
      else if (to !== layer && !ALLOWED[layer].includes(to)) add('layer-import', `${layer} -> ${to}${isType ? ' (type)' : ''} ${specifier}`, node)
      return to
    }
    const module = ioModule(specifier)
    if (io && module && !isType) add('io-module', module, node)
    return undefined
  }

  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue
    const specifier = statement.moduleSpecifier.text
    const to = reference(specifier, statement, typeOnly(statement))
    const clause = statement.importClause
    if (!clause || clause.isTypeOnly) continue
    const names = [
      clause.name?.text,
      ...(clause.namedBindings && ts.isNamedImports(clause.namedBindings) ? clause.namedBindings.elements.filter(e => !e.isTypeOnly).map(e => e.name.text) : [])
    ]
    if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) names.push(clause.namedBindings.name.text)
    if (to === 'infra') for (const name of names) if (name) infraNames.add(name)
  }

  const visit = (node: ts.Node) => {
    if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) reference(node.moduleSpecifier.text, node, node.isTypeOnly)
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && ts.isStringLiteral(node.arguments[0]))
      reference(node.arguments[0].text, node, false)
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'require' && node.arguments[0] && ts.isStringLiteral(node.arguments[0]))
      reference(node.arguments[0].text, node, false)
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) reference(node.argument.literal.text, node, true)

    if (io) {
      if (ts.isCallExpression(node)) {
        const callee = node.expression
        if (ts.isIdentifier(callee) && callee.text === 'fetch') add('io-fetch', 'fetch', node)
        if (ts.isPropertyAccessExpression(callee) && callee.name.text === 'fetch' && ts.isIdentifier(callee.expression) && ['globalThis', 'self'].includes(callee.expression.text))
          add('io-fetch', 'fetch', node)
        if (ts.isPropertyAccessExpression(callee) && PRISMA_RAW.has(callee.name.text)) add('prisma', 'prisma', node, callee.name.text)
        if (
          ts.isPropertyAccessExpression(callee) &&
          PRISMA_OPS.has(callee.name.text) &&
          ts.isPropertyAccessExpression(callee.expression) &&
          context.models.has(callee.expression.name.text)
        )
          add('prisma', 'prisma', node, `${callee.expression.name.text}.${callee.name.text}`)
      }
      if (ts.isTaggedTemplateExpression(node) && ts.isPropertyAccessExpression(node.tag) && PRISMA_RAW.has(node.tag.name.text)) add('prisma', 'prisma', node, node.tag.name.text)
      if (ts.isPropertyAccessExpression(node) && binding(node.name.text) && envLike(node.expression, source)) add('env-binding', node.name.text, node)
      if (ts.isElementAccessExpression(node) && ts.isStringLiteral(node.argumentExpression) && binding(node.argumentExpression.text) && envLike(node.expression, source))
        add('env-binding', node.argumentExpression.text, node)
      if (ts.isVariableDeclaration(node) && node.initializer && ts.isObjectBindingPattern(node.name) && envLike(node.initializer, source))
        for (const element of node.name.elements) {
          const key = element.propertyName ?? element.name
          if (ts.isIdentifier(key) && binding(key.text)) add('env-binding', key.text, element)
        }
      if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && IO_GLOBALS.has(node.expression.text)) add('io-global', node.expression.text, node)
      if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node)) && SQL.test(node.text.trim()))
        add('raw-sql', node.text.trim().split(/\s+/)[0].toUpperCase(), node)
    }
    if (!CONSTRUCTS_INFRA.includes(layer) && ts.isNewExpression(node) && ts.isIdentifier(node.expression) && infraNames.has(node.expression.text))
      add('infra-construct', node.expression.text, node)
    ts.forEachChild(node, visit)
  }
  visit(source)
  return found
}

export function loadContext(root = API_DIR): Context {
  const env = fs.readFileSync(path.join(root, 'worker-configuration.d.ts'), 'utf8').split('// Begin runtime types')[0]
  const bindings = new Map(
    [...env.matchAll(/^\s+([A-Z][A-Z0-9_]*)\??:\s*([^\n]+)/gm)].filter(match => BINDING_TYPES.test(match[2].trim())).map(match => [match[1], match[2].trim()] as const)
  )
  const models = new Set<string>()
  for (const dir of ['prisma', 'prisma/pgsql', 'prisma/logs']) {
    const full = path.join(root, dir)
    if (!fs.existsSync(full)) continue
    for (const name of fs.readdirSync(full))
      if (name.endsWith('.prisma')) for (const match of fs.readFileSync(path.join(full, name), 'utf8').matchAll(/^model\s+(\w+)\s*\{/gm)) models.add(match[1])
  }
  return { bindings, models }
}

export function sourceFiles(root = API_DIR, dir = 'src'): string[] {
  return fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap(entry => {
    const relative = path.posix.join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(root, relative)
    return entry.name.endsWith('.ts') ? [relative] : []
  })
}

export const violationKey = (violation: Pick<Violation, 'rule' | 'file' | 'detail'>) => `${violation.rule} ${violation.file} ${violation.detail}`

export function countViolations(violations: Violation[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const violation of violations) counts[violationKey(violation)] = (counts[violationKey(violation)] ?? 0) + 1
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)))
}
