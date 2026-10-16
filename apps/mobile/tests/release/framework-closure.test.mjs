import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {requiredDylibs, verifyFrameworkClosure} from '../../tooling/ios-frameworks.mjs';

const load = (name, command = 'LC_LOAD_DYLIB') => `Load command 1\n cmd ${command}\n cmdsize 72\n name ${name} (offset 24)\n`;

test('Mach-O dependency parsing includes required loads and skips IDs and weak system libraries', () => {
  assert.deepEqual(requiredDylibs(load('@rpath/React.framework/React', 'LC_ID_DYLIB') + load('@rpath/ReactNativeDependencies.framework/ReactNativeDependencies') + load('/usr/lib/swift/libswiftCore.dylib', 'LC_LOAD_WEAK_DYLIB')), ['@rpath/ReactNativeDependencies.framework/ReactNativeDependencies']);
});

test('a present React framework cannot hide a missing transitive native dependency', {skip: process.platform !== 'darwin'}, t => {
  const root = mkdtempSync(path.join(tmpdir(), 'slax-framework-closure-'));
  t.after(() => rmSync(root, {recursive: true, force: true}));
  const app = path.join(root, 'SlaxReader.app');
  const bundle = (relative, executable) => {
    const directory = path.join(app, relative);
    mkdirSync(directory, {recursive: true});
    writeFileSync(path.join(directory, 'Info.plist'), JSON.stringify({CFBundleExecutable: executable}));
    writeFileSync(path.join(directory, executable), 'synthetic binary');
  };
  bundle('', 'SlaxReader');
  bundle('Frameworks/React.framework', 'React');
  const inspect = binary => path.basename(binary) === 'SlaxReader'
    ? load('@rpath/React.framework/React')
    : path.basename(binary) === 'React' ? load('@rpath/ReactNativeDependencies.framework/ReactNativeDependencies') : load('/usr/lib/libSystem.B.dylib');
  assert.throws(() => verifyFrameworkClosure(app, inspect), /Missing embedded dependency.*ReactNativeDependencies/);
  bundle('Frameworks/ReactNativeDependencies.framework', 'ReactNativeDependencies');
  assert.deepEqual(verifyFrameworkClosure(app, inspect), {executablesChecked: 3});
  assert.throws(() => verifyFrameworkClosure(app, () => load('@loader_path/../../outside.dylib')), /Missing embedded dependency/);
});
