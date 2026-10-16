import {spawnSync} from 'node:child_process';
import {copyFileSync, existsSync, mkdirSync, realpathSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

// The Kotlin framework must already be built. This makes a simulator-only app with public ad hoc signing.
const root = realpathSync(fileURLToPath(new URL('./', import.meta.url)));
const framework = path.join(root, 'build/bin/iosSimulatorArm64/debugFramework');
if (!existsSync(path.join(framework, 'SlaxLegacyFixture.framework/Headers/SlaxLegacyFixture.h'))) throw new Error('Build linkDebugFrameworkIosSimulatorArm64 first; no source or existing app is modified');
const sdk = spawnSync('xcrun', ['--sdk', 'iphonesimulator', '--show-sdk-path'], {encoding: 'utf8'});
if (sdk.status !== 0) throw new Error('The iOS Simulator SDK is unavailable');
const output = path.join(root, 'build/SlaxLegacyFixture.app');
mkdirSync(output, {recursive: true});
copyFileSync(path.join(root, 'Info.plist'), path.join(output, 'Info.plist'));
const compile = spawnSync('xcrun', ['swiftc', '-parse-as-library', '-module-name', 'SlaxLegacyFixtureApp', '-swift-version', '5', '-target', 'arm64-apple-ios16.4-simulator', '-sdk', sdk.stdout.trim(), '-F', framework, '-framework', 'SlaxLegacyFixture', '-lsqlite3', path.join(root, 'LegacyFixtureApp.swift'), '-o', path.join(output, 'SlaxLegacyFixture')], {stdio: 'inherit'});
if (compile.status !== 0) process.exit(compile.status ?? 1);
const sign = spawnSync('codesign', ['--force', '--sign', '-', '--entitlements', path.join(root, 'SlaxLegacyFixture.entitlements'), output], {stdio: 'inherit'});
if (sign.status !== 0) process.exit(sign.status ?? 1);
console.log(JSON.stringify({app: output, bundleIdentifier: 'app.slax.reader', sdk: 'powersync-kotlin-1.14.1', simulatorOnly: true, productionSigning: false, deviceExecuted: false}, null, 2));
