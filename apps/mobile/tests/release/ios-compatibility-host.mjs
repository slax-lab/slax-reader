import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {copyFileSync, mkdirSync, mkdtempSync, writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {incompatibleImports, verifyEasIosArtifact, verifyIosArtifact} from '../../tooling/ios-compatibility.mjs';

assert(process.platform === 'darwin', 'This explicit-module probe requires macOS and Xcode');
const require = createRequire(import.meta.url);
const nitro = path.dirname(require.resolve('react-native-nitro-modules/package.json'));
const react = path.dirname(require.resolve('react-native/package.json'));
const root = mkdtempSync(path.join(tmpdir(), 'slax-nitro-compatibility-host-'));
const sdk = execFileSync('xcrun', ['--sdk', 'iphoneos', '--show-sdk-path'], {encoding: 'utf8'}).trim();
const include = ['apple/core/utils', 'cpp/core/core', 'cpp/core/utils', 'cpp/core/threading'].map(directory => path.join(nitro, directory));
include.push(path.join(react, 'ReactCommon/jsi'));
const run = (program, args) => execFileSync(program, args, {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 8 * 1024 * 1024});
console.log(`Compatibility evidence directory: ${root}`);

for (const fixed of [false, true]) {
  const directory = path.join(root, fixed ? 'fixed' : 'known-bad');
  mkdirSync(directory);
  const header = fixed
    ? '#include "RuntimeError.hpp"\n#include "Promise.hpp"\nnamespace probe { inline auto error(const std::string& s) { return margelo::nitro::makeException(s); } inline void pending() { auto p = margelo::nitro::Promise<double>::create(); } }\n'
    : '#include <exception>\n#include <stdexcept>\nnamespace probe { inline auto error(const std::string& s) { return std::make_exception_ptr(std::runtime_error(s)); } inline void pending() {} }\n';
  writeFileSync(path.join(directory, 'Probe.hpp'), header);
  writeFileSync(path.join(directory, 'module.modulemap'), 'module NativeCompatibility { header "Probe.hpp" requires cplusplus export * }\n');
  const source = path.join(directory, 'Probe.swift');
  writeFileSync(source, 'import NativeCompatibility\npublic func convert(_ s: String) -> std.exception_ptr { probe.error(std.string(s)) }\npublic func pending() { probe.pending() }\n');
  for (const optimization of ['-Onone', '-O']) {
    const object = path.join(directory, `${optimization.slice(1)}.o`);
    run('xcrun', ['swiftc', '-explicit-module-build', '-swift-version', '5', optimization, '-cxx-interoperability-mode=default', '-target', 'arm64-apple-ios16.4', '-sdk', sdk, '-I', directory, '-Xcc', '-std=c++20', '-Xcc', '-DNDEBUG', ...include.flatMap(value => ['-Xcc', `-I${value}`]), '-module-cache-path', path.join(directory, 'ModuleCache'), '-c', source, '-o', object]);
    const imports = incompatibleImports(run('xcrun', ['nm', '-m', '-u', object]));
    assert.equal(imports.length, fixed ? 0 : 2, `${directory} ${optimization}: ${imports}`);
    assert.match(run('xcrun', ['vtool', '-show-build', object]), /minos 16\.4\b/);
    console.log(`${fixed ? 'fixed' : 'known-bad'} ${optimization}: ${imports.length} incompatible required imports; minos 16.4`);
  }
  const payload = path.join(directory, 'Payload'), app = path.join(payload, 'SlaxReader.app');
  mkdirSync(app, {recursive: true});
  writeFileSync(path.join(app, 'Info.plist'), JSON.stringify({CFBundleExecutable: 'SlaxReader', MinimumOSVersion: '16.4'}));
  copyFileSync(path.join(directory, 'O.o'), path.join(app, 'SlaxReader'));
  const ipa = path.join(directory, 'Probe.ipa');
  run('ditto', ['-c', '-k', '--keepParent', payload, ipa]);
  writeFileSync(path.join(directory, 'eas.json'), JSON.stringify({build: {production: {ios: {applicationArchivePath: 'Probe.ipa'}}}}));
  const eas = () => verifyEasIosArtifact({EAS_BUILD_PLATFORM: 'ios', EAS_BUILD_PROFILE: 'production'}, directory);
  if (fixed) {
    assert.deepEqual(verifyIosArtifact(ipa), {executablesChecked: 1});
    assert.deepEqual(eas(), {executablesChecked: 1});
  } else {
    assert.throws(() => verifyIosArtifact(ipa), /requires iOS 18-only libc\+\+ imports/);
    assert.throws(eas, /requires iOS 18-only libc\+\+ imports/);
  }
}

const host = path.join(root, 'Host.cpp'), executable = path.join(root, 'host');
writeFileSync(host, `#include "RuntimeError.hpp"
#include "Promise.hpp"
#include <iostream>
int main() {
  using namespace margelo::nitro;
  auto error = makeException("native exception message");
  if (getExceptionMessage(error) != "native exception message") return 1;
  bool rejected = false;
  auto pending = Promise<double>::create();
  pending->addOnRejectedListener([&](const std::exception_ptr& value) { rejected = getExceptionMessage(value).find("was destroyed!") != std::string::npos; });
  pending.reset();
  if (!rejected) return 2;
  std::cout << "Native exception message and pending-Promise rejection preserved\\n";
}
`);
run('xcrun', ['clang++', '-std=c++20', '-O', '-DNDEBUG', ...include.flatMap(value => ['-I', value]), host, path.join(nitro, 'cpp/core/utils/NitroTypeInfo.cpp'), '-o', executable]);
console.log(run(executable, []));
console.log('PASS: Swift explicit-module regression, real Mach-O/IPA/EAS validation, and host error behavior');
