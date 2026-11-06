import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {globSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {applicationExecutables} from './ios-frameworks.mjs';

const incompatible = new Set([
  '__ZNSt13exception_ptr31__from_native_exception_pointerEPv',
  '___cxa_init_primary_exception',
]);

export function incompatibleImports(output) {
  return [...new Set([...output.matchAll(/^\s*\(undefined\)\s+external\s+(\S+)/gm)]
    .map(match => match[1]).filter(symbol => incompatible.has(symbol)))];
}

export function verifyIosCompatibility(application, inspect = binary => execFileSync('xcrun', ['nm', '-m', '-u', binary], {encoding: 'utf8', maxBuffer: 8 * 1024 * 1024})) {
  const root = realpathSync(application), binaries = applicationExecutables(root);
  for (const binary of binaries) {
    const symbols = incompatibleImports(inspect(binary));
    assert(symbols.length === 0, `${path.relative(root, binary)} requires iOS 18-only libc++ imports: ${symbols.join(', ')}`);
  }
  return {executablesChecked: binaries.length};
}

export function verifyIosArtifact(artifact, inspect) {
  if (artifact.endsWith('.app')) return verifyIosCompatibility(artifact, inspect);
  assert(artifact.endsWith('.ipa'), 'Expected an iOS .app bundle or .ipa artifact');
  const entries = execFileSync('unzip', ['-Z1', artifact], {encoding: 'utf8', maxBuffer: 8 * 1024 * 1024}).trim().split('\n');
  assert(entries.length && entries.every(entry => !entry.startsWith('/') && !entry.includes('\\') && !entry.split('/').includes('..')), 'Refuse an unsafe IPA member path');
  const temporary = mkdtempSync(path.join(tmpdir(), 'slax-ios-compatibility-'));
  try {
    execFileSync('ditto', ['-x', '-k', artifact, temporary]);
    const payload = path.join(temporary, 'Payload'), applications = readdirSync(payload);
    assert(applications.length === 1 && applications[0].endsWith('.app'), 'Expected exactly one application in the IPA Payload');
    return verifyIosCompatibility(path.join(payload, applications[0]), inspect);
  } finally {rmSync(temporary, {recursive: true, force: true});}
}

export function verifyEasIosArtifact(environment = process.env, project = fileURLToPath(new URL('../', import.meta.url)), inspect) {
  if (environment.EAS_BUILD_PLATFORM === 'android') return {skipped: 'android'};
  assert(environment.EAS_BUILD_PLATFORM === 'ios', 'Expected EAS_BUILD_PLATFORM=ios or android');
  const config = JSON.parse(readFileSync(path.join(project, 'eas.json'), 'utf8'));
  const pattern = config.build[environment.EAS_BUILD_PROFILE]?.ios?.applicationArchivePath;
  assert(typeof pattern === 'string' && pattern.length > 0, 'The EAS profile must configure ios.applicationArchivePath');
  const artifacts = globSync(pattern, {cwd: project});
  assert(artifacts.length === 1, `Expected exactly one completed iOS artifact matching ${pattern}, found ${artifacts.length}`);
  return verifyIosArtifact(path.resolve(project, artifacts[0]), inspect);
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  assert((args.length === 1 && args[0] === '--eas') || (args.length === 2 && args[0] === '--artifact'), 'Use --artifact /path/to/application.app|ipa or --eas');
  console.log(JSON.stringify(args[0] === '--eas' ? verifyEasIosArtifact() : verifyIosArtifact(path.resolve(args[1]))));
}
