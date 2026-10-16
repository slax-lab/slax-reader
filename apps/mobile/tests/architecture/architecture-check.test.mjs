import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {dirname, resolve} from 'node:path';
import ts from 'typescript';
import {buildModuleGraph, checkArchitecture, formatDiagnostic, loadMobileProject, mobileArchitecture, mobileRoot} from '../../tooling/architecture-check.mjs';

function fixture(sources, run, config = {}) {
  const root = mkdtempSync(resolve(tmpdir(), 'mobile-architecture-'));
  try {
    for (const [path, text] of Object.entries(sources)) {
      const file = resolve(root, path);
      mkdirSync(dirname(file), {recursive: true});
      writeFileSync(file, text);
    }
    const graph = buildModuleGraph({root, files: Object.keys(sources).filter(path => /\.[cm]?[jt]sx?$/.test(path)), ...config});
    const result = checkArchitecture(graph, {...mobileArchitecture, exceptions: []});
    return run({root, graph, result});
  } finally {
    rmSync(root, {recursive: true, force: true});
  }
}

const rules = result => result.violations.map(item => item.rule);

test('resolves extensionless imports, directory barrels, JS-to-TS and TSX exports', () => {
  fixture({
    'src/entry.ts': "import {value} from './lib'; export {View} from './View'; export {other} from './other.js'; import {explicit} from './explicit.ts';",
    'src/lib/index.ts': "export {value} from './value';",
    'src/lib/value.ts': 'export const value = 1;',
    'src/View.tsx': 'export function View() {return <view/>;}',
    'src/other.ts': 'export const other = 2;',
    'src/explicit.ts': 'export const explicit = 3;',
  }, ({graph, result}) => {
    assert.deepEqual(result.violations, []);
    assert.deepEqual(graph.modules.get('src/entry.ts').edges.map(edge => edge.target), ['src/lib/index.ts', 'src/View.tsx', 'src/other.ts', 'src/explicit.ts']);
    assert.equal(graph.modules.get('src/lib/index.ts').edges[0].kind, 'export');
  });
});

test('keeps imports, exports, inline types and import types in the graph without runtime cycles', () => {
  fixture({
    'src/a.ts': "import type {B} from './b'; export type {B} from './b'; export {type B} from './b'; import {type B as Other} from './b'; export type A = import('./b').B;",
    'src/b.ts': "import './a'; export interface B {}",
  }, ({graph, result}) => {
    assert.deepEqual(result.violations, []);
    assert.equal(graph.modules.get('src/a.ts').edges.length, 5);
    assert.ok(graph.modules.get('src/a.ts').edges.every(edge => edge.typeOnly));
  });
});

test('reports a deterministic runtime cycle through barrel exports with source lines', () => {
  fixture({
    'src/a.ts': "import {b} from './barrel'; export const a = b;",
    'src/barrel.ts': "export * from './b';",
    'src/b.ts': "\nimport {a} from './a'; export const b = a;",
  }, ({graph, result}) => {
    assert.deepEqual(rules(result), ['runtime-cycle']);
    const rendered = result.violations.map(formatDiagnostic);
    assert.deepEqual(rendered, ['src/b.ts:2:1 [runtime-cycle] Runtime import cycle: src/a.ts:1 -> src/barrel.ts:1 -> src/b.ts:2 -> src/a.ts.']);
    const reordered = buildModuleGraph({root: graph.root, files: ['src/barrel.ts', 'src/b.ts', 'src/a.ts']});
    assert.deepEqual(checkArchitecture(reordered, {...mobileArchitecture, exceptions: []}).violations.map(formatDiagnostic), rendered);
  });
});

test('mixed imports/exports, namespace exports, dynamic import and require remain runtime edges', () => {
  for (const statement of [
    "import {type B, b} from './b';",
    "export {type B, b} from './b';",
    "export * as b from './b';",
    "import {} from './b';",
    "const b = import('./b');",
    "const b = require('./b');",
    "import b = require('./b');",
  ]) {
    fixture({'src/a.ts': statement, 'src/b.ts': "import './a'; export const b = 1; export type B = number;"}, ({result}) => {
      assert.deepEqual(rules(result), ['runtime-cycle'], statement);
    });
  }
});

test('pure policies reject React Native, adapters, UI and concrete data type imports', () => {
  fixture({
    'src/domain/policy.ts': "import type {ViewStyle} from 'react-native';\nimport '../adapters/store';\nimport '../components/SourceBox';\nimport type {Api} from '../data/api';",
    'src/adapters/store.ts': 'export {};',
    'src/components/SourceBox.tsx': 'export {};',
    'src/data/api.ts': 'export interface Api {}',
  }, ({result}) => {
    assert.deepEqual(rules(result), Array(4).fill('pure-dependency'));
    assert.deepEqual(result.violations.map(item => item.line), [1, 2, 3, 4]);
  });
});

test('pure math and controller ports remain allowed without broad UI restrictions on state', () => {
  fixture({
    'src/domain/policy.ts': "import {clamp} from '../utils/math'; import type {Port} from './ports'; export const apply = clamp;",
    'src/domain/ports.ts': 'export interface Port {save(): void}',
    'src/utils/math.ts': 'export const clamp = Math.max;',
    'src/reader/host/geometry.ts': "import type {Point} from '../coordinates';",
    'src/reader/coordinates.ts': 'export interface Point {x: number}',
    'src/reader/state/useDocument.ts': "import type {Api} from '../../data/api'; export const run = (api: Api) => api.load();",
    'src/data/api.ts': 'export interface Api {load(): void}',
    'src/reader/components/Body.tsx': "import type {Api} from '../../data/api'; import type {Point} from '../coordinates'; export const Body = ({onOpen}: {onOpen(): void}) => <button onClick={onOpen}/>;",
  }, ({result}) => assert.deepEqual(result.violations, []));
});

test('Source and designated shared modules cannot import features, and legacy components cannot import screens', () => {
  fixture({
    'src/components/SourceBox.tsx': "export * from '../settings/model';",
    'src/shared/Button.tsx': "import type {Screen} from '../screens/Screen';",
    'src/components/LegacyFeature.tsx': "import '../screens/Screen';",
    'src/settings/model.ts': 'export const state = 1;',
    'src/screens/Screen.tsx': 'export interface Screen {}',
  }, ({result}) => {
    assert.ok(result.violations.some(item => item.file === 'src/components/SourceBox.tsx' && item.rule === 'shared-feature'));
    assert.ok(result.violations.some(item => item.file === 'src/shared/Button.tsx' && item.rule === 'shared-screen'));
    assert.ok(result.violations.some(item => item.file === 'src/components/LegacyFeature.tsx' && item.rule === 'shared-screen'));
  });
});

test('Reader presentation rejects context, service owners, SQL, network, files and account transitions', () => {
  fixture({
    'src/reader/components/Body.tsx': [
      "import {useMobile as useApp} from '../../runtime';",
      "import {api} from '../../data/api';",
      "import {File} from 'expo-file-system';",
      "import {useDocument} from '../state/useDocument';",
      'const owner = useMobile();',
      "fetch('/article');",
      "globalThis.fetch('/article');",
      "db.execute('SELECT id FROM article');",
      "db.query('DELETE FROM article');",
      "fs.readFile('article');",
      'session.signOut();',
    ].join('\n'),
    'src/runtime.tsx': 'export const useMobile = () => ({});',
    'src/data/api.ts': 'export const api = {};',
    'src/reader/state/useDocument.ts': 'export const useDocument = () => ({});',
  }, ({result}) => {
    assert.deepEqual(rules(result), [
      ...Array(4).fill('presentation-service'), 'presentation-context',
      ...Array(5).fill('presentation-io'), 'presentation-account',
    ]);
    assert.equal(result.violations[0].line, 1);
    assert.equal(result.violations.at(-1).line, 11);
  });
});

test('AST ignores import-looking strings/comments and detects multiline imports and re-exports', () => {
  fixture({
    'src/reader/components/Body.tsx': "// fetch('/nope'); import '../missing';\nconst text = \"useMobile(); fetch('/nope')\";\nexport {\n api\n} from '../../data/api';",
    'src/data/api.ts': 'export const api = {};',
  }, ({graph, result}) => {
    assert.equal(graph.modules.get('src/reader/components/Body.tsx').edges.length, 1);
    assert.deepEqual(rules(result), ['presentation-service']);
    assert.equal(result.violations[0].line, 3);
  });
});

test('only the exact generated output is excluded; new generated-looking files remain checked', () => {
  fixture({
    'src/reader/embedded.generated.ts': "import './missing'; function !!!",
    'src/reader/components/new.generated.ts': "fetch('/article');",
    'src/reader/document.ts': "import './embedded.generated';",
  }, ({graph, result}) => {
    assert.equal(graph.modules.has('src/reader/embedded.generated.ts'), false);
    assert.equal(graph.modules.get('src/reader/document.ts').edges[0].target, 'src/reader/embedded.generated.ts');
    assert.deepEqual(rules(result), ['presentation-io']);
  });
});

test('exceptions require an exact statement, rule, file and reason and cannot mask an added occurrence', () => {
  const statement = "import {Api} from '../data/api';";
  fixture({'src/domain/policy.ts': `${statement}\n${statement}`, 'src/data/api.ts': 'export class Api {}'}, ({graph}) => {
    const exception = {rule: 'pure-dependency', file: 'src/domain/policy.ts', statement, rationale: 'Existing injected port awaits extraction.'};
    const result = checkArchitecture(graph, {...mobileArchitecture, exceptions: [exception]});
    assert.equal(result.exempted.length, 1);
    assert.deepEqual(rules(result), ['pure-dependency']);
    assert.equal(result.violations[0].line, 2);
    assert.match(result.exempted[0].rationale, /port/);
    const noReason = checkArchitecture(graph, {...mobileArchitecture, exceptions: [{...exception, rationale: ''}]});
    assert.equal(noReason.exempted.length, 0);
    assert.ok(rules(noReason).includes('stale-exception'));
    const changed = checkArchitecture(graph, {...mobileArchitecture, exceptions: [{...exception, statement: "import {Other} from '../data/api';"}]});
    assert.equal(changed.exempted.length, 0);
    assert.ok(rules(changed).includes('stale-exception'));
  });
});

test('unresolved local code and malformed source fail rather than silently disappearing', () => {
  fixture({'src/a.ts': "import './absent';\nconst = ;"}, ({result}) => {
    assert.ok(rules(result).includes('unresolved-import'));
    assert.ok(rules(result).includes('parse'));
  });
});

test('loads roots and resolver options from tsconfig rather than scanning test/generated/native trees', () => {
  fixture({
    'tsconfig.json': JSON.stringify({compilerOptions: {module: 'ESNext', moduleResolution: 'Bundler'}, include: ['src/**/*.ts'], exclude: ['src/excluded.ts']}),
    'src/app.ts': 'export const app = 1;',
    'src/excluded.ts': 'export const excluded = 1;',
    'tests/not-source.ts': 'export const test = 1;',
  }, ({root}) => {
    const project = loadMobileProject(root);
    assert.deepEqual(project.files, [resolve(root, 'src/app.ts')]);
    assert.equal(project.compilerOptions.moduleResolution, ts.ModuleResolutionKind.Bundler);
    assert.deepEqual([...buildModuleGraph({root}).modules.keys()], ['src/app.ts']);
  });
});

test('actual mobile graph obeys the checked-in policy and is wired into mobile check', () => {
  const graph = buildModuleGraph();
  assert.ok(graph.modules.has('src/App.tsx'));
  assert.ok(graph.modules.has('src/reader/components/ReaderHeader.tsx'));
  assert.ok(graph.modules.has('src/domain/session.ts'));
  assert.equal(graph.modules.has('src/reader/embedded.generated.ts'), false);
  const result = checkArchitecture(graph);
  assert.deepEqual(result.violations.map(formatDiagnostic), []);
  assert.equal(result.exempted.length, mobileArchitecture.exceptions.length);
  const check = ts.createSourceFile('check.mjs', readFileSync(resolve(mobileRoot, 'tooling/check.mjs'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const scripts = [];
  const visit = node => {if (ts.isStringLiteral(node)) scripts.push(node.text); ts.forEachChild(node, visit);};
  visit(check);
  assert.ok(scripts.includes('./architecture-check.mjs'));
  const cli = spawnSync(process.execPath, [resolve(mobileRoot, 'tooling/architecture-check.mjs')], {cwd: tmpdir(), encoding: 'utf8'});
  assert.equal(cli.status, 0, cli.stderr);
  assert.match(cli.stdout, /Mobile architecture: \d+ modules, 0 violations, 3 exact existing exceptions\./);
});
