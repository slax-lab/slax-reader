import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {readFileSync} from 'node:fs';
import {applyMobileEnvironment} from './deploy-environment.cjs';
import {readBuildVersion} from './build-version.cjs';

applyMobileEnvironment();

const platform = process.argv[2];
const release = process.argv.includes('--release');
const unsigned = process.argv.includes('--unsigned');
const app = fileURLToPath(new URL('../', import.meta.url));
if (release) {
  if (process.env.EXPO_PUBLIC_SLAX_ADOPTION_FIXTURE === '1' || process.env.EXPO_PUBLIC_SLAX_UI_FIXTURE) throw new Error('Controlled fixtures require a development build and cannot produce release artifacts.');
  const {version, build: number} = readBuildVersion();
  const native = platform === 'android' ? readFileSync(`${app}/android/app/build.gradle`, 'utf8') : readFileSync(`${app}/ios/SlaxReader/Info.plist`, 'utf8');
  const matches = platform === 'android' ? native.includes(`versionCode ${number}`) && native.includes(`versionName "${version}"`) : native.includes(`<string>${number}</string>`) && native.includes(`<string>${version}</string>`);
  if (!matches) throw new Error('Regenerate the native project with pnpm mobile -- prebuild after updating apps/mobile/package.json before building.');
  if (platform === 'android' && !unsigned && !['SLAX_ANDROID_KEYSTORE_PATH', 'SLAX_ANDROID_KEYSTORE_PASSWORD', 'SLAX_ANDROID_KEY_ALIAS', 'SLAX_ANDROID_KEY_PASSWORD'].every(key => Boolean(process.env[key]))) {
    throw new Error('Android signed release requires deploy/mobile/android/slax-reader.release.jks and SLAX_ANDROID_KEYSTORE_PASSWORD, SLAX_ANDROID_KEY_ALIAS, SLAX_ANDROID_KEY_PASSWORD in deploy/mobile/.env or the process environment; SLAX_ANDROID_KEYSTORE_PATH can override the file path. --unsigned builds only a verification artifact.');
  }
  if (platform === 'ios' && !unsigned) throw new Error('This command builds an unsigned simulator artifact. Use --unsigned explicitly for Release validation; device signing and archive export belong to the operator-managed Xcode release workflow.');
}
const forwarded = process.argv.slice(3).filter(arg => !['--release', '--unsigned'].includes(arg));
let command, args, cwd;
if (platform === 'android') {
  command = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
  const native = readFileSync(`${app}/android/app/build.gradle`, 'utf8');
  if (release && (!native.includes('// Slax release signing: operator-managed environment only.') || /release \{[^}]*signingConfig = signingConfigs.debug/.test(native))) throw new Error('Regenerate native projects: release builds cannot use the template debug signing identity.');
  args = [release ? 'assembleRelease' : 'assembleDebug', ...forwarded];
  cwd = `${app}/android`;
} else if (platform === 'ios') {
  command = 'xcodebuild';
  args = ['-workspace', 'SlaxReader.xcworkspace', '-scheme', 'SlaxReader', '-configuration', release ? 'Release' : 'Debug', '-sdk', 'iphonesimulator', '-destination', 'generic/platform=iOS Simulator', 'CODE_SIGNING_ALLOWED=NO', ...forwarded];
  cwd = `${app}/ios`;
} else if (platform === 'pods') {
  command = 'pod'; args = ['install', ...forwarded]; cwd = `${app}/ios`;
} else throw new Error('Use build:android, build:ios, or pods.');
const result = spawnSync(command, args, { cwd, stdio: 'inherit', env: unsigned ? {...process.env, SLAX_MOBILE_UNSIGNED: '1'} : process.env });
if (result.error) console.error(result.error.message);
process.exitCode = result.status ?? 1;
