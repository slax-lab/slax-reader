import {readFileSync, statSync} from 'node:fs';
import {dirname, relative, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';

export const mobileRoot = fileURLToPath(new URL('../', import.meta.url));
const slash = path => path.split(sep).join('/');
const within = (path, directory) => path === directory || path.startsWith(`${directory}/`);
const sourceExtension = /\.(?:[cm]?[jt]sx?)$/;
const assetExtension = /\.(?:png|jpe?g|gif|webp|svg|ttf|otf|woff2?|html|css|wasm|pdf|json)$/i;
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;

export const mobileArchitecture = {
  generated: ['src/reader/embedded.generated.ts'],
  pure: ['src/domain', 'src/reader/host/geometry.ts', 'src/reader/pdf-geometry.ts', 'src/motion/policy.ts'],
  shared: ['src/shared', 'src/components/shared'],
  presentation: ['src/reader/components', 'src/settings/components', 'src/settings/SettingsView.tsx', 'src/settings/DeleteAccountView.tsx'],
  exceptions: [
    {
      rule: 'pure-dependency', file: 'src/domain/session.ts',
      statement: "import { PreferenceStore, PREFERENCE_KEYS as K } from '../data/preferences.ts';",
      rationale: 'Existing session owner consumes the platform-independent preference store and keys; move its storage port in the auth extraction, not in this check.',
    },
    {
      rule: 'pure-dependency', file: 'src/domain/session.ts',
      statement: "import type { PreferenceValues } from '../data/preferences.ts';",
      rationale: 'Existing session preference shape remains alongside the preference store until the auth port extraction.',
    },
    {
      rule: 'pure-dependency', file: 'src/domain/delete-account.ts',
      statement: "import type {SlaxApi} from '../data/api.ts';",
      rationale: 'Existing deletion policy uses only Pick<SlaxApi, deleteAccount> as an injected port; retain this type coupling until the API port is extracted.',
    },
  ],
};

export function loadMobileProject(root = mobileRoot) {
  const configPath = resolve(root, 'tsconfig.json');
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root, undefined, configPath);
  if (parsed.errors.length) throw new Error(parsed.errors.map(error => ts.flattenDiagnosticMessageText(error.messageText, '\n')).join('\n'));
  const files = parsed.fileNames.filter(file => within(slash(relative(root, file)), 'src'));
  if (!files.length) throw new Error('The mobile tsconfig contains no src modules.');
  return {files, compilerOptions: parsed.options};
}

function collectDependencies(source) {
  const dependencies = [];
  const add = (node, literal, typeOnly, kind) => {
    if (literal && ts.isStringLiteralLike(literal)) dependencies.push({node, specifier: literal.text, typeOnly, kind});
  };
  const visit = node => {
    if (ts.isImportDeclaration(node)) {
      const clause = node.importClause;
      const named = clause?.namedBindings;
      const typeOnly = Boolean(clause?.isTypeOnly || (!clause?.name && named && ts.isNamedImports(named) && named.elements.length > 0 && named.elements.every(item => item.isTypeOnly)));
      add(node, node.moduleSpecifier, typeOnly, 'import');
    } else if (ts.isExportDeclaration(node)) {
      const clause = node.exportClause;
      const typeOnly = Boolean(node.isTypeOnly || (clause && ts.isNamedExports(clause) && clause.elements.length > 0 && clause.elements.every(item => item.isTypeOnly)));
      add(node, node.moduleSpecifier, typeOnly, 'export');
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      add(node, node.moduleReference.expression, node.isTypeOnly, 'require');
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      add(node, node.argument.literal, true, 'type');
    } else if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) add(node, node.arguments[0], false, 'dynamic');
      if (ts.isIdentifier(node.expression) && node.expression.text === 'require') add(node, node.arguments[0], false, 'require');
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return dependencies;
}

function regularFile(path) {
  try {return statSync(path).isFile();} catch {return false;}
}

export function buildModuleGraph({root = mobileRoot, files, compilerOptions, generated = mobileArchitecture.generated} = {}) {
  if (!files) ({files, compilerOptions} = loadMobileProject(root));
  const options = compilerOptions ?? {moduleResolution: ts.ModuleResolutionKind.Bundler, module: ts.ModuleKind.ESNext, allowJs: true};
  const modules = new Map(), diagnostics = [], excluded = new Set(generated);
  const cache = ts.createModuleResolutionCache(root, file => file, options);
  const localPath = file => slash(relative(root, file));
  const visit = absolute => {
    const file = localPath(absolute);
    if (modules.has(file) || excluded.has(file) || file.startsWith('../') || !sourceExtension.test(file)) return;
    const source = ts.createSourceFile(absolute, readFileSync(absolute, 'utf8'), ts.ScriptTarget.Latest, true);
    const record = {file, source, edges: []};
    modules.set(file, record);
    for (const error of source.parseDiagnostics) {
      const position = source.getLineAndCharacterOfPosition(error.start ?? 0);
      diagnostics.push({rule: 'parse', file, line: position.line + 1, column: position.character + 1, statement: '', message: ts.flattenDiagnosticMessageText(error.messageText, ' ')});
    }
    for (const dependency of collectDependencies(source)) {
      const position = source.getLineAndCharacterOfPosition(dependency.node.getStart(source));
      const edge = {...dependency, file, line: position.line + 1, column: position.character + 1, statement: dependency.node.getText(source)};
      if (dependency.specifier.startsWith('.')) {
        const base = resolve(dirname(absolute), dependency.specifier);
        const resolved = ts.resolveModuleName(dependency.specifier, absolute, options, ts.sys, cache).resolvedModule?.resolvedFileName;
        const fallback = [base, `${base}.native.ts`, `${base}.native.tsx`, `${base}.ios.ts`, `${base}.ios.tsx`, `${base}.android.ts`, `${base}.android.tsx`].find(regularFile);
        edge.target = localPath(resolved ?? fallback ?? base);
        if (!resolved && !fallback && !assetExtension.test(base) && !excluded.has(edge.target)) {
          diagnostics.push({...edge, rule: 'unresolved-import', message: `Cannot resolve local ${edge.kind} ${JSON.stringify(edge.specifier)} using the mobile tsconfig.`});
        }
        if (resolved || fallback) visit(resolve(root, edge.target));
      }
      record.edges.push(edge);
    }
  };
  for (const file of [...files].sort(compare)) visit(resolve(root, file));
  return {root, modules, diagnostics};
}

const services = /^(?:expo-file-system(?:\/|$)|expo\/fetch$|(?:node:)?fs(?:\/|$)|@powersync\/|@op-engineering\/|react-native-fs(?:\/|$))/;
const nativePackages = /^(?:react(?:\/|$)|react-native(?:[/-]|$)|expo(?:[/-]|$)|@react-native(?:[/-]|$)|@react-navigation\/|@powersync\/|@op-engineering\/)/;
const servicePaths = ['src/data', 'src/runtime.tsx', 'src/runtime.ts', 'src/auth', 'src/payments', 'src/rss', 'src/pdf', 'src/native', 'src/adapters'];
const featurePaths = ['src/screens', 'src/reader', 'src/settings', 'src/library', 'src/features', 'src/navigation'];
const ioCalls = new Set(['fetch', 'readFile', 'readFileSync', 'writeFile', 'writeFileSync', 'readAsStringAsync', 'writeAsStringAsync', 'downloadAsync', 'openDatabase', 'openDatabaseAsync', 'execute', 'executeAsync', 'execAsync', 'getAllAsync', 'getFirstAsync', 'watchRows']);
const accountCalls = new Set(['signOut', 'logout', 'deleteAccount', 'setSession', 'clearIfMatches']);
const callName = expression => ts.isIdentifier(expression) ? expression.text : ts.isPropertyAccessExpression(expression) ? expression.name.text : ts.isElementAccessExpression(expression) && ts.isStringLiteralLike(expression.argumentExpression) ? expression.argumentExpression.text : '';

function boundaryDiagnostics(graph, config) {
  const diagnostics = [];
  for (const record of graph.modules.values()) {
    const {file, source} = record;
    const pure = config.pure.some(path => within(file, path));
    const shared = config.shared.some(path => within(file, path)) || /^src\/components\/Source[^/]*\.[jt]sx?$/.test(file);
    const presentation = shared || config.presentation.some(path => within(file, path));
    for (const edge of record.edges) {
      const isService = services.test(edge.specifier) || servicePaths.some(path => within(edge.target ?? '', path));
      const isFeature = featurePaths.some(path => within(edge.target ?? '', path));
      const add = (rule, message) => diagnostics.push({...edge, rule, message: `${message}: ${edge.specifier}${edge.typeOnly ? ' (type-only)' : ''}.`});
      const isUi = /\.tsx$/.test(edge.target ?? '') || ['src/components', 'src/shared', 'src/screens', 'src/reader/components', 'src/reader/state', 'src/settings', 'src/library', 'src/features', 'src/navigation'].some(path => within(edge.target ?? '', path));
      if (pure && (isService || isUi || nativePackages.test(edge.specifier))) {
        add('pure-dependency', 'Pure policy cannot depend on UI, platform packages or infrastructure');
      }
      if ((within(file, 'src/components') || shared) && within(edge.target ?? '', 'src/screens')) {
        add('shared-screen', 'Shared components cannot depend on route screens');
      } else if (shared && isFeature) {
        add('shared-feature', 'Generic Source/shared UI cannot depend on feature modules');
      }
      if (presentation && !edge.typeOnly && (isService || within(edge.target ?? '', 'src/screens') || (within(file, 'src/reader/components') && within(edge.target ?? '', 'src/reader/state')))) {
        add('presentation-service', 'Explicit-prop UI must receive state/actions rather than import service owners');
      }
    }
    if (!presentation) continue;
    const visit = node => {
      if (ts.isCallExpression(node)) {
        const name = callName(node.expression);
        const sql = node.arguments[0];
        const literalSql = sql && ts.isStringLiteralLike(sql) && /^\s*(?:SELECT\b[\s\S]*\bFROM|INSERT\s+INTO|UPDATE\b[\s\S]*\bSET|DELETE\s+FROM|CREATE\s+TABLE|PRAGMA\b)/i.test(sql.text);
        const rule = name === 'useMobile' ? 'presentation-context' : ioCalls.has(name) || literalSql ? 'presentation-io' : accountCalls.has(name) ? 'presentation-account' : undefined;
        if (rule) {
          const position = source.getLineAndCharacterOfPosition(node.getStart(source));
          diagnostics.push({rule, file, line: position.line + 1, column: position.character + 1, statement: node.getText(source), message: `Explicit-prop UI cannot execute ${name || 'SQL'}; pass an owned action from feature state.`});
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return diagnostics;
}

function cycleDiagnostics(graph) {
  const diagnostics = [], visited = new Set(), active = new Map(), stack = [], path = [];
  const visit = file => {
    visited.add(file);
    active.set(file, stack.length);
    stack.push(file);
    const edges = graph.modules.get(file).edges.filter(edge => !edge.typeOnly && graph.modules.has(edge.target));
    edges.sort((a, b) => compare(a.target, b.target) || a.line - b.line || a.column - b.column);
    for (const edge of edges) {
      if (active.has(edge.target)) {
        const cycle = [...path.slice(active.get(edge.target)), edge];
        const trail = cycle.map(item => `${item.file}:${item.line}`).concat(edge.target).join(' -> ');
        diagnostics.push({...edge, rule: 'runtime-cycle', message: `Runtime import cycle: ${trail}.`});
      } else if (!visited.has(edge.target)) {
        path.push(edge);
        visit(edge.target);
        path.pop();
      }
    }
    stack.pop();
    active.delete(file);
  };
  for (const file of [...graph.modules.keys()].sort(compare)) if (!visited.has(file)) visit(file);
  return diagnostics;
}

const normalizeStatement = statement => statement.replace(/\s+/g, ' ').trim();
export function checkArchitecture(graph, config = mobileArchitecture) {
  const diagnostics = [...graph.diagnostics, ...boundaryDiagnostics(graph, config), ...cycleDiagnostics(graph)];
  diagnostics.sort((a, b) => compare(a.file, b.file) || a.line - b.line || a.column - b.column || compare(a.rule, b.rule));
  const used = new Set(), exceptions = config.exceptions ?? [], violations = [], exempted = [];
  for (const diagnostic of diagnostics) {
    const index = exceptions.findIndex((exception, index) => !used.has(index) && exception.rationale?.trim() && exception.file === diagnostic.file && exception.rule === diagnostic.rule && normalizeStatement(exception.statement) === normalizeStatement(diagnostic.statement));
    if (index < 0) violations.push(diagnostic);
    else {used.add(index); exempted.push({...diagnostic, rationale: exceptions[index].rationale});}
  }
  exceptions.forEach((exception, index) => {
    if (!used.has(index)) violations.push({rule: 'stale-exception', file: exception.file, line: 1, column: 1, statement: exception.statement, message: 'Remove or correct this unused exception; every exception needs one exact violation and a rationale.'});
  });
  violations.sort((a, b) => compare(a.file, b.file) || a.line - b.line || a.column - b.column || compare(a.rule, b.rule));
  return {violations, exempted};
}

export function formatDiagnostic(diagnostic) {
  return `${diagnostic.file}:${diagnostic.line}:${diagnostic.column} [${diagnostic.rule}] ${diagnostic.message}`;
}

export function runArchitectureCheck(root = mobileRoot) {
  const graph = buildModuleGraph({root});
  const result = checkArchitecture(graph);
  for (const diagnostic of result.violations) console.error(formatDiagnostic(diagnostic));
  console.log(`Mobile architecture: ${graph.modules.size} modules, ${result.violations.length} violations, ${result.exempted.length} exact existing exceptions.`);
  return result.violations.length ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = runArchitectureCheck();
