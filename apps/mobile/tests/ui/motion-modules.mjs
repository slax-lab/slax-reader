import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

export function motionModules(boundaries) {
  const result = {};
  for (const name of ['policy', 'useReducedMotion']) {
    if (name === 'useReducedMotion' && (!boundaries.react || !boundaries['react-native'])) continue;
    const url = new URL(`../../src/motion/${name}.ts`, import.meta.url);
    const code = ts.transpileModule(readFileSync(url, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText;
    const exports = {};
    vm.runInNewContext(code, {exports, require(name) {assert.ok(Object.hasOwn(boundaries, name), name); return boundaries[name];}}, {filename: url.pathname});
    result[`../motion/${name}`] = exports;
  }
  return result;
}
