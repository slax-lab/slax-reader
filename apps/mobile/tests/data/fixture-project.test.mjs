import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {allowedSourceFiles, fixtureCommands} from '../../tooling/fixture-project.mjs';

test('UI project whitelist includes native module source and skips secrets, generated builds and root native projects', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'slax-fixture-whitelist-'));
  try {
    for (const name of ['app.config.ts', 'babel.config.cjs', 'metro.config.cjs', 'package.json', 'index.ts', 'tsconfig.json', 'tooling/native-build.mjs', 'tooling/fixture-project.mjs', 'tooling/deploy-environment.cjs', 'tooling/build-version.cjs', 'src/App.tsx', 'assets/logo.png', 'modules/local/android/src/Module.kt', 'modules/local/android/build.gradle', 'native/share/ios/Share.swift', 'plugins/example.cjs', 'fixtures/scenarios.json', 'tests/source.test.ts']) {
      const file = path.join(root, name); mkdirSync(path.dirname(file), {recursive: true}); writeFileSync(file, 'synthetic source');
    }
    for (const name of ['src/.env', 'src/.dev.vars.local', 'assets/private-key.pem', 'modules/local/android/debug.keystore', 'fixtures/google-services.json', 'fixtures/GoogleService-Info.plist', 'ios', 'android']) symlinkSync('/nonexistent-path-must-never-be-opened', path.join(root, name));
    mkdirSync(path.join(root, 'tests/generated'), {recursive: true}); symlinkSync('/nonexistent-build-input', path.join(root, 'tests/generated/state.json'));
    const files = allowedSourceFiles(root);
    assert.ok(files.includes('modules/local/android/src/Module.kt')); assert.ok(files.includes('assets/logo.png'));
    assert.equal(files.some(file => /\.env|\.dev\.vars|keystore|GoogleService|google-services|private-key|generated/.test(file)), false);
    assert.equal(files.some(file => file.startsWith('ios/') || file.startsWith('android/')), false);
  } finally {rmSync(root, {recursive: true, force: true});}
});
test('UI source whitelist rejects symlinks in an otherwise approved source subtree', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'slax-fixture-whitelist-'));
  try {
    for (const name of ['app.config.ts', 'babel.config.cjs', 'metro.config.cjs', 'package.json', 'index.ts', 'tsconfig.json', 'tooling/native-build.mjs', 'tooling/fixture-project.mjs', 'tooling/deploy-environment.cjs', 'tooling/build-version.cjs']) {mkdirSync(path.dirname(path.join(root, name)), {recursive: true}); writeFileSync(path.join(root, name), 'synthetic source');}
    mkdirSync(path.join(root, 'src')); symlinkSync('/nonexistent-external-source', path.join(root, 'src/external.ts'));
    assert.throws(() => allowedSourceFiles(root), /symlinks are not permitted/);
  } finally {rmSync(root, {recursive: true, force: true});}
});
test('UI project commands reject arbitrary directories and unmarked controlled temp paths before reading configuration', () => {
  const ordinary = mkdtempSync(path.join(tmpdir(), 'slax-other-project-'));
  const controlled = mkdtempSync(path.join(tmpdir(), 'slax-reader-ui-fixture-'));
  try {assert.throws(() => fixtureCommands(ordinary), /system temp/); assert.throws(() => fixtureCommands(controlled), /marker is missing/);}
  finally {rmSync(ordinary, {recursive: true, force: true}); rmSync(controlled, {recursive: true, force: true});}
});
