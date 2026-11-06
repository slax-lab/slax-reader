import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import * as compatibility from '../../tooling/ios-compatibility.mjs';

const exception = '__ZNSt13exception_ptr31__from_native_exception_pointerEPv';
const primary = '___cxa_init_primary_exception';
const required = symbol => `(undefined) external ${symbol} (from libc++)\n`;

test('only the two exact required undefined imports are incompatible', () => {
  const output = required(exception) + required(primary) + required(exception)
    + required(`${exception}_other`) + required('__ZSt17current_exceptionv')
    + `(undefined) weak external ${primary} (from libc++)\n`
    + `0000000100000000 (__TEXT,__text) external ${exception}\n`;
  assert.deepEqual(compatibility.incompatibleImports(output), [exception, primary]);
  assert.deepEqual(compatibility.incompatibleImports(`(undefined) weak external ${exception}\n`), []);
});

function application(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'slax-ios-compatibility-test-'));
  t.after(() => rmSync(root, {recursive: true, force: true}));
  const app = path.join(root, 'SlaxReader.app');
  for (const [relative, executable] of [['', 'SlaxReader'], ['PlugIns/SlaxShare.appex', 'SlaxShare'], ['Frameworks/Nitro.framework', 'Nitro']]) {
    const directory = path.join(app, relative);
    mkdirSync(directory, {recursive: true});
    writeFileSync(path.join(directory, 'Info.plist'), JSON.stringify({CFBundleExecutable: executable, MinimumOSVersion: '16.4'}));
    writeFileSync(path.join(directory, executable), 'synthetic executable');
  }
  writeFileSync(path.join(app, 'Frameworks/helper.dylib'), 'synthetic dylib');
  return realpathSync(app);
}

test('compatibility checks every delivered image even with MinimumOSVersion 16.4', {skip: process.platform !== 'darwin'}, t => {
  const app = application(t);
  const inspected = [];
  assert.deepEqual(compatibility.verifyIosCompatibility(app, binary => {
    inspected.push(path.relative(app, binary));
    return required('__ZSt17current_exceptionv');
  }), {executablesChecked: 4});
  assert.deepEqual(inspected.sort(), ['Frameworks/Nitro.framework/Nitro', 'Frameworks/helper.dylib', 'PlugIns/SlaxShare.appex/SlaxShare', 'SlaxReader']);
  for (const image of inspected) {
    assert.throws(() => compatibility.verifyIosCompatibility(app, binary => path.relative(app, binary) === image ? required(exception) : ''), error => error.message.includes(image) && error.message.includes(exception));
  }
  assert.deepEqual(compatibility.verifyIosCompatibility(app, () => `(undefined) weak external ${primary}\n`), {executablesChecked: 4});
});

test('an IPA is inspected after extraction, including embedded imports', {skip: process.platform !== 'darwin'}, t => {
  assert.equal(typeof compatibility.verifyIosArtifact, 'function');
  const app = application(t), root = path.dirname(app), payload = path.join(root, 'Payload');
  mkdirSync(payload);
  execFileSync('ditto', [app, path.join(payload, 'SlaxReader.app')]);
  const ipa = path.join(root, 'SlaxReader.ipa');
  execFileSync('ditto', ['-c', '-k', '--keepParent', payload, ipa]);
  assert.deepEqual(compatibility.verifyIosArtifact(ipa, () => ''), {executablesChecked: 4});
  assert.throws(() => compatibility.verifyIosArtifact(ipa, binary => binary.endsWith('SlaxShare') ? required(primary) : ''), /SlaxShare.*___cxa_init_primary_exception/);
});

test('EAS validates its configured completed iOS artifact and fails without exactly one', {skip: process.platform !== 'darwin'}, t => {
  assert.equal(typeof compatibility.verifyEasIosArtifact, 'function');
  const app = application(t), root = path.dirname(app), artifact = path.join(root, 'ios/build/SlaxReader.app');
  mkdirSync(path.dirname(artifact), {recursive: true});
  execFileSync('ditto', [app, artifact]);
  writeFileSync(path.join(root, 'eas.json'), JSON.stringify({build: {production: {ios: {applicationArchivePath: 'ios/build/*.app'}}}}));
  assert.deepEqual(compatibility.verifyEasIosArtifact({EAS_BUILD_PLATFORM: 'android'}, root), {skipped: 'android'});
  const environment = {EAS_BUILD_PLATFORM: 'ios', EAS_BUILD_PROFILE: 'production'};
  assert.deepEqual(compatibility.verifyEasIosArtifact(environment, root, () => ''), {executablesChecked: 4});
  assert.throws(() => compatibility.verifyEasIosArtifact(environment, root, () => required(exception)), /SlaxReader.*requires iOS 18/);
  execFileSync('ditto', [app, path.join(root, 'ios/build/Other.app')]);
  assert.throws(() => compatibility.verifyEasIosArtifact(environment, root, () => ''), /exactly one/);
  rmSync(path.join(root, 'ios/build'), {recursive: true});
  assert.throws(() => compatibility.verifyEasIosArtifact(environment, root, () => ''), /exactly one/);
});
