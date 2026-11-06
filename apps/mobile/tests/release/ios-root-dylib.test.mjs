import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {verifyIosCompatibility} from '../../tooling/ios-compatibility.mjs';

test('the application root debug dylib cannot hide incompatible main code', {skip: process.platform !== 'darwin'}, t => {
  const app = mkdtempSync(path.join(tmpdir(), 'slax-root-dylib-'));
  t.after(() => rmSync(app, {recursive: true, force: true}));
  writeFileSync(path.join(app, 'Info.plist'), JSON.stringify({CFBundleExecutable: 'SlaxReader'}));
  writeFileSync(path.join(app, 'SlaxReader'), 'launcher');
  writeFileSync(path.join(app, 'SlaxReader.debug.dylib'), 'main code');
  assert.throws(() => verifyIosCompatibility(app, binary => path.basename(binary) === 'SlaxReader.debug.dylib'
    ? '(undefined) external __ZNSt13exception_ptr31__from_native_exception_pointerEPv\n' : ''), /SlaxReader\.debug\.dylib.*requires iOS 18/);
});
