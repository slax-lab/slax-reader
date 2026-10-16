import {createHash} from 'node:crypto'
import {cp, mkdir, readFile, realpath, stat, writeFile} from 'node:fs/promises'
import {spawnSync} from 'node:child_process'
import path from 'node:path'
import os from 'node:os'

const args = process.argv.slice(2)
if (args.length !== 2 || args[0] !== '--project') throw new Error('Use --project with a marked isolated iOS source fixture stage')
const project = await realpath(args[1])
if (![await realpath('/tmp'), await realpath(os.tmpdir())].some(root => project.startsWith(root + path.sep)) || !/^slax-source-ui-fixture-[a-z0-9-]+$/.test(path.basename(project))) throw new Error('An isolated temporary source fixture stage is required')
const marker = JSON.parse(await readFile(path.join(project, 'slax-source-fixture.json'), 'utf8'))
if (!marker.controlledFixture || marker.fixtureVersion !== 1 || marker.platform !== 'ios-simulator-arm64' || marker.bundleIdentifier !== 'app.slax.reader.sourcefixture' || marker.sourceCheckoutModified !== false || marker.originalBuildConfigurationCopied !== false) throw new Error('The iOS source fixture marker is invalid')
async function checkedFile(relative) {
  if (path.isAbsolute(relative) || relative.split('/').some(part => !part || part === '.' || part === '..') || /(?:\.env|\.dev\.vars|credential|secret|private.?key|keystore|GoogleService|google-services)/i.test(relative)) throw new Error('Forbidden public input path')
  const file = path.join(project, relative)
  if (await realpath(file) !== file || !(await stat(file)).isFile()) throw new Error('Fixture inputs must be regular files without symlinks')
  return readFile(file)
}
for (const record of marker.overlayDigests) if (createHash('sha256').update(await checkedFile(record.path)).digest('hex') !== record.sha256) throw new Error(`Staged fixture input changed: ${record.path}`)
const framework = path.join(project, 'composeApp/build/bin/iosSimulatorArm64/debugFramework/SlaxSourceFixture.framework')
if (!(await stat(path.join(framework, 'SlaxSourceFixture'))).isFile()) throw new Error('First build :composeApp:linkDebugFrameworkIosSimulatorArm64 with the sanitized stage')
const resources = path.join(project, 'composeApp/build/generated/compose/resourceGenerator/preparedResources/commonMain/composeResources')
if (!(await stat(resources)).isDirectory()) throw new Error('Original prepared Compose resources are required')
const output = path.join(project, 'ios-harness/build')
const app = path.join(output, 'SlaxSourceFixtureApp.app')
await mkdir(path.join(app, 'Frameworks'), {recursive: true})
await cp(framework, path.join(app, 'Frameworks/SlaxSourceFixture.framework'), {recursive: true})
await cp(path.join(project, 'ios-harness/Info.plist'), path.join(app, 'Info.plist'))
await cp(path.join(project, 'ios-harness/slax-ui-fixtures'), path.join(app, 'slax-ui-fixtures'), {recursive: true})
await cp(resources, path.join(app, 'compose-resources/composeResources/slax_reader_client.composeapp.generated.resources'), {recursive: true})
function run(command, args) {
  const result = spawnSync(command, args, {stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8'})
  if (result.status !== 0) throw new Error(`${command} failed (${result.status}):\n${result.stdout}\n${result.stderr}`)
  return result.stdout.trim()
}
const sdk = run('xcrun', ['--sdk', 'iphonesimulator', '--show-sdk-path'])
run('xcrun', ['--sdk', 'iphonesimulator', 'swiftc', '-parse-as-library', '-swift-version', '5', '-target', 'arm64-apple-ios16.4-simulator', '-sdk', sdk,
  '-F', path.dirname(framework), '-framework', 'SlaxSourceFixture', '-framework', 'UIKit', '-framework', 'Foundation', '-framework', 'WebKit',
  '-Xlinker', '-rpath', '-Xlinker', '@executable_path/Frameworks', path.join(project, 'ios-harness/main.swift'),
  path.join(project, 'ios-harness/FixtureReaderStep.swift'), '-o', path.join(app, 'SlaxSourceFixtureApp')])
run('codesign', ['--force', '--sign', '-', path.join(app, 'Frameworks/SlaxSourceFixture.framework')])
run('codesign', ['--force', '--sign', '-', app])
run('codesign', ['--verify', '--deep', '--strict', app])
const report = {...marker, sourceNativeBuild: 'debug-framework-and-public-ad-hoc-simulator-app-built', simulatorOnly: true,
  sourceIosAdapter: 'compiled-in-real-kotlin-framework', sourceReaderAdapter: 'compiled-native-execution-unverified',
  packagingDriverSha256: createHash('sha256').update(await readFile(new URL(import.meta.url))).digest('hex'),
  simulatorInstall: 'not-performed-by-build-driver', nativeVisualAcceptance: 'unverified', nativeInteractionVerified: false,
  appPath: app, executableSha256: createHash('sha256').update(await readFile(path.join(app, 'SlaxSourceFixtureApp'))).digest('hex'),
  frameworkSha256: createHash('sha256').update(await readFile(path.join(app, 'Frameworks/SlaxSourceFixture.framework/SlaxSourceFixture'))).digest('hex')}
await writeFile(path.join(output, 'source-ios-build-report.json'), JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify({appPath: app, reportPath: path.join(output, 'source-ios-build-report.json'), simulatorOnly: true, nativeVisualAcceptance: 'unverified'}))
