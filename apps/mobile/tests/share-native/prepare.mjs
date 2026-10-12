import assert from 'node:assert/strict';
import {constants, copyFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const app = path.resolve(here, '../..');
const require = createRequire(import.meta.url);
const sharePlugin = require('../../plugins/with-share.cjs')._test;
const args = process.argv.slice(2), options = {};
for (let index = 0; index < args.length; index += 2) {
  assert(['--api-origin', '--artifact', '--run-id', '--device'].includes(args[index]) && args[index + 1], 'Use only explicit public fixture inputs');
  assert(!options[args[index]], 'Repeated fixture input'); options[args[index]] = args[index + 1];
}
assert(Object.keys(options).length === 4);
const api = new URL(options['--api-origin']);
assert(api.protocol === 'http:' && api.hostname === '127.0.0.1' && Number(api.port) > 1024 && api.origin === options['--api-origin'], 'Use the owned loopback controller');
assert(/^[a-zA-Z0-9-]{1,64}$/.test(options['--run-id']));
assert(/^[a-fA-F0-9-]{36}$/.test(options['--device']));
const artifact = realpathSync(options['--artifact']);
assert(path.dirname(artifact) === realpathSync('/tmp/slax-mobile-native-artifacts') && path.basename(artifact) === 'SlaxReader-ios-debug-identity-757-group-only.app', 'Use the preserved, public simulator development artifact');
const command = (program, args) => {
  const result = spawnSync(program, args, {encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024});
  assert.equal(result.status, 0, `Controlled ${program} command failed`); return result.stdout.trim();
};
const plist = (file, key) => command('plutil', ['-extract', key, 'raw', '-o', '-', file]);
for (const [file, id] of [[path.join(artifact, 'Info.plist'), 'app.slax.reader'], [path.join(artifact, 'PlugIns/SlaxShare.appex/Info.plist'), 'app.slax.reader.share']]) {
  assert.equal(plist(file, 'CFBundleIdentifier'), id); assert.equal(plist(file, 'CFBundleShortVersionString'), '1.0.25'); assert.equal(plist(file, 'CFBundleVersion'), '757');
}
command('codesign', ['--verify', '--deep', '--strict', artifact]);
const directory = realpathSync(mkdtempSync(path.join(tmpdir(), 'slax-cold-share-')));
const output = path.join(directory, 'project'); mkdirSync(output);
for (const name of ['ShareFixtureHost.swift', 'ShareFixtureControl.swift']) copyFileSync(path.join(here, name), path.join(output, name));
const project = path.join(output, 'ShareFixtureControl.xcodeproj'); mkdirSync(path.join(project, 'xcshareddata/xcschemes'), {recursive: true});
const template = path.join(app, 'fixtures/source-ios/control');
let source = readFileSync(path.join(template, 'SourceFixtureControl.xcodeproj/project.pbxproj'), 'utf8').replaceAll('SourceFixtureControl', 'ShareFixtureControl').replaceAll('ControlHost', 'ShareFixtureHost').replaceAll('app.slax.reader.sourcefixture.controlhost', 'app.slax.reader.sharefixturehost').replaceAll('app.slax.reader.sourcefixture.control', 'app.slax.reader.sharefixturecontrol');
source = source.replace('buildPhases = (A00000000000000000000023)', 'buildPhases = (A00000000000000000000023, A00000000000000000000030)');
source = source.replace('A00000000000000000000021, A00000000000000000000004', 'A00000000000000000000021, A00000000000000000000031, A00000000000000000000032, A00000000000000000000004');
source = source.replace('PRODUCT_BUNDLE_IDENTIFIER = app.slax.reader.sharefixturehost;', 'PRODUCT_BUNDLE_IDENTIFIER = app.slax.reader.sharefixturehost; CODE_SIGN_ENTITLEMENTS = ShareFixtureHost.entitlements; INFOPLIST_KEY_NSAppTransportSecurity_NSAllowsArbitraryLoads = YES;');
source = source.replace('  };\n  rootObject', `    A00000000000000000000030 = {isa = PBXResourcesBuildPhase; buildActionMask = 2147483647; files = (A00000000000000000000033); runOnlyForDeploymentPostprocessing = 0;};
    A00000000000000000000031 = {isa = PBXFileReference; lastKnownFileType = text.plist.entitlements; path = ShareFixtureHost.entitlements; sourceTree = "<group>";};
    A00000000000000000000032 = {isa = PBXFileReference; lastKnownFileType = text.json; path = fixture-input.json; sourceTree = "<group>";};
    A00000000000000000000033 = {isa = PBXBuildFile; fileRef = A00000000000000000000032;};
  };\n  rootObject`);
writeFileSync(path.join(project, 'project.pbxproj'), source);
writeFileSync(path.join(project, 'xcshareddata/xcschemes/ShareFixtureControl.xcscheme'), readFileSync(path.join(template, 'SourceFixtureControl.xcodeproj/xcshareddata/xcschemes/SourceFixtureControl.xcscheme'), 'utf8').replaceAll('SourceFixtureControl', 'ShareFixtureControl'));
const entitlements = '<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>com.apple.security.application-groups</key><array><string>group.app.slax.reader</string></array></dict></plist>\n';
writeFileSync(path.join(output, 'ShareFixtureHost.entitlements'), entitlements);
writeFileSync(path.join(output, 'fixture-input.json'), JSON.stringify({apiOrigin: api.origin, runId: options['--run-id'], device: options['--device']}, null, 2));
const copied = path.join(directory, 'SlaxReader.app'); cpSync(artifact, copied, {recursive: true, mode: constants.COPYFILE_FICLONE});
const extension = path.join(copied, 'PlugIns/SlaxShare.appex');
const generated = path.join(directory, 'generated-share');
sharePlugin.writeIosFiles(generated, app, sharePlugin.normalizedOptions({version: '1.0.25', ios: {buildNumber: '757'}}, {apiBaseUrl: api.origin}));
const activation = command('plutil', ['-extract', 'NSExtension.NSExtensionAttributes', 'xml1', '-o', '-', path.join(generated, 'SlaxShare/Info.plist')]);
command('plutil', ['-replace', 'NSExtension.NSExtensionAttributes', '-xml', activation, path.join(extension, 'Info.plist')]);
for (const key of ['SlaxApiBaseURL', 'SlaxApiBetaURL']) command('plutil', ['-replace', key, '-string', api.origin, path.join(extension, 'Info.plist')]);
command('plutil', ['-insert', 'NSAppTransportSecurity', '-xml', '<dict><key>NSAllowsArbitraryLoads</key><true/></dict>', path.join(extension, 'Info.plist')]);
command('codesign', ['--force', '--sign', '-', '--entitlements', path.join(output, 'ShareFixtureHost.entitlements'), extension]);
command('codesign', ['--force', '--sign', '-', '--entitlements', path.join(output, 'ShareFixtureHost.entitlements'), copied]);
command('codesign', ['--verify', '--deep', '--strict', copied]);
const hash = file => createHash('sha256').update(readFileSync(file)).digest('hex');
function compiledSections(executable) {
  const bytes = readFileSync(executable);
  assert.equal(bytes.readUInt32LE(0), 0xfeedfacf, 'Use the preserved thin arm64 Mach-O');
  const sections = []; let offset = 32;
  for (let index = 0; index < bytes.readUInt32LE(16); index++) {
    const type = bytes.readUInt32LE(offset), length = bytes.readUInt32LE(offset + 4);
    assert(length >= 8 && offset + length <= bytes.length);
    if (type === 0x19) {
      const count = bytes.readUInt32LE(offset + 64);
      assert(length >= 72 + count * 80);
      for (let sectionIndex = 0; sectionIndex < count; sectionIndex++) {
        const start = offset + 72 + sectionIndex * 80;
        const section = bytes.subarray(start, start + 16).toString().replace(/\0.*$/, '');
        const segment = bytes.subarray(start + 16, start + 32).toString().replace(/\0.*$/, '');
        const size = Number(bytes.readBigUInt64LE(start + 40)), location = bytes.readUInt32LE(start + 48), flags = bytes.readUInt32LE(start + 64) & 255;
        assert(Number.isSafeInteger(size));
        if (size && ![1, 12, 18].includes(flags)) {
          assert(location > 0 && location + size <= bytes.length);
          sections.push({segment, section, size, sha256: createHash('sha256').update(bytes.subarray(location, location + size)).digest('hex')});
        }
      }
    }
    offset += length;
  }
  assert(sections.some(value => value.segment === '__TEXT' && value.section === '__text'));
  return sections;
}
const mainSections = compiledSections(path.join(artifact, 'SlaxReader')), shareSections = compiledSections(path.join(artifact, 'PlugIns/SlaxShare.appex/SlaxShare'));
const compiledMainSectionsUnchanged = JSON.stringify(mainSections) === JSON.stringify(compiledSections(path.join(copied, 'SlaxReader')));
const compiledExtensionSectionsUnchanged = JSON.stringify(shareSections) === JSON.stringify(compiledSections(path.join(extension, 'SlaxShare')));
assert(compiledMainSectionsUnchanged && compiledExtensionSectionsUnchanged, 'Changing only public fixture configuration must preserve every file-backed Mach-O section');
// Xcode's Debug executable is a launcher; application code also lives in this dylib.
const mainDebugLibrarySHA256 = hash(path.join(artifact, 'SlaxReader.debug.dylib'));
assert.equal(hash(path.join(copied, 'SlaxReader.debug.dylib')), mainDebugLibrarySHA256, 'The actual main application native code must remain byte-identical');
const marker = {kind: 'slax-controlled-cold-share', version: 1, runId: options['--run-id'], device: options['--device'], directory, project: output, mainArtifact: copied, mainApplicationClosedRequired: true, apiOrigin: api.origin, productionRequests: false, publisherSigned: false, activationFromOwnedPlugin: true, sharePluginSHA256: hash(path.join(app, 'plugins/with-share.cjs')), executableComparison: 'Every file-backed launcher/extension Mach-O section excluding code-signature/link-edit metadata; complete main Debug library bytes', compiledMainSectionsUnchanged, compiledExtensionSectionsUnchanged, mainDebugLibraryUnchanged: true, mainDebugLibrarySHA256, mainSections, shareSections, sourceInputs: Object.fromEntries(['ShareFixtureHost.swift', 'ShareFixtureControl.swift', 'controller.mjs', 'prepare.mjs'].map(name => [name, hash(path.join(here, name))]))};
writeFileSync(path.join(directory, 'fixture-owner.json'), JSON.stringify(marker, null, 2) + '\n');
console.log(JSON.stringify(marker));
