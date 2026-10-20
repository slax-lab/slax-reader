import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath, pathToFileURL} from 'node:url';

const MOBILE_ROOT = fileURLToPath(new URL('../', import.meta.url));
const PREFIX = 'slax-reader-ui-fixture-';
const MARKER = '.slax-ui-fixture-project.json';
const ANDROID_ID = 'com.slax.reader.uifixture', IOS_ID = 'app.slax.reader.uifixture', SCHEME = 'slaxreader-ui-fixture';
export function fixtureIds(identity = '') {
  assert(!identity || /^[a-z0-9]{1,24}$/.test(identity), 'Fixture identity must be a lowercase alphanumeric suffix of at most 24 characters');
  return {androidId: `${ANDROID_ID}${identity ? `.${identity}` : ''}`, iosId: `${IOS_ID}${identity ? `.${identity}` : ''}`, scheme: `${SCHEME}${identity ? `-${identity}` : ''}`};
}
const FILES = ['app.config.ts', 'babel.config.cjs', 'metro.config.cjs', 'package.json', 'index.ts', 'tsconfig.json', 'tooling/native-build.mjs', 'tooling/fixture-project.mjs', 'tooling/fixture-control.mjs', 'tooling/fixture-control-contract.mjs', 'tooling/deploy-environment.cjs', 'tooling/build-version.cjs'];
const TREES = ['src', 'assets', 'modules', 'native/share', 'plugins', 'fixtures', 'tests'];
const SKIP_DIRECTORIES = new Set(['node_modules', '.git', '.gradle', '.expo', 'build', 'dist', 'generated', 'new-owner', 'Pods', 'DerivedData', 'operator', 'credentials']);
const EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.cjs', '.mjs', '.json', '.md', '.txt', '.css', '.html', '.py', '.kt', '.kts', '.gradle', '.swift', '.java', '.xml', '.podspec', '.h', '.m', '.mm', '.c', '.cpp', '.properties', '.yml', '.yaml', '.sql', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.ico', '.ttf', '.otf', '.ttc', '.woff', '.woff2']);
const forbiddenName = name => /^(?:\.env(?:\.|$)|\.dev\.vars(?:\.|$)|local\.properties$|google-services\.json$|GoogleService-Info\.plist$|credentials(?:\.|$)|secrets?(?:\.|$)|signing(?:\.|$)|private[-_.]?key(?:\.|$))/i.test(name) || /\.(?:keystore|jks|p12|pfx|mobileprovision|pem|key|db|db-wal|db-shm|dylib|so|apk|aab)$/i.test(name);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function assert(condition, message) {if (!condition) throw new Error(message);}
const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Temporary projects lie outside the monorepo; Metro must watch the linked dependency store. */
export function fixtureMetroConfig() {
  return `const fs = require('node:fs');
const path = require('node:path');
const {getDefaultConfig} = require('expo/metro-config');
const config = getDefaultConfig(__dirname);
const linkedModules = fs.realpathSync(path.join(__dirname, 'node_modules'));
const expoPackage = require.resolve('expo/package.json');
const parts = expoPackage.split(path.sep), storeIndex = parts.indexOf('.pnpm');
const dependencyRoot = storeIndex < 0 ? path.dirname(path.dirname(expoPackage)) : parts.slice(0, storeIndex).join(path.sep);
config.watchFolders = [...new Set([...config.watchFolders, linkedModules, dependencyRoot])];
config.resolver.nodeModulesPaths = [...new Set([...config.resolver.nodeModulesPaths, linkedModules, dependencyRoot])];
module.exports = config;
`;
}

/** Explicit source roots and extensions only; skip forbidden names before opening files. */
export function allowedSourceFiles(sourceRoot) {
  const files = [];
  function visit(relative) {
    const name = path.basename(relative);
    if (forbiddenName(name) || SKIP_DIRECTORIES.has(name) || name.startsWith('.')) return;
    const absolute = path.join(sourceRoot, relative), stat = lstatSync(absolute);
    assert(!stat.isSymbolicLink(), `Source symlinks are not permitted: ${relative}`);
    if (stat.isDirectory()) {
      for (const child of readdirSync(absolute).sort()) visit(path.join(relative, child));
    } else if (stat.isFile() && EXTENSIONS.has(path.extname(name).toLowerCase())) files.push(relative.split(path.sep).join('/'));
  }
  for (const file of FILES) {assert(existsSync(path.join(sourceRoot, file)), `Missing required fixture source: ${file}`); visit(file);}
  for (const directory of TREES) {assert(existsSync(path.join(sourceRoot, directory)), `Missing fixture source directory: ${directory}`); visit(directory);}
  return [...new Set(files)].sort();
}
function fixtureEnv(scenario, locale, identity = '') {
  const env = {};
  for (const key of ['PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'TMPDIR', 'LANG', 'LC_ALL', 'TERM', 'JAVA_HOME', 'ANDROID_HOME', 'ANDROID_SDK_ROOT', 'DEVELOPER_DIR', 'SDKROOT']) if (process.env[key]) env[key] = process.env[key];
  return {...env, CI: '1', EXPO_NO_DOTENV: '1', EXPO_NO_TELEMETRY: '1', EXPO_NO_METRO_LAZY: '1', EXPO_PUBLIC_SLAX_UI_FIXTURE: scenario, EXPO_PUBLIC_SLAX_UI_FIXTURE_LOCALE: locale, ...(identity ? {EXPO_PUBLIC_SLAX_UI_FIXTURE_ID: identity} : {}), EXPO_PUBLIC_SLAX_ADOPTION_FIXTURE: '0', SLAX_MOBILE_UNSIGNED: '1'};
}
function scopeProject(projectRoot) {
  const canonical = realpathSync(projectRoot), temp = realpathSync(tmpdir());
  assert(path.dirname(canonical) === temp && new RegExp(`^${PREFIX}[a-zA-Z0-9]+$`).test(path.basename(canonical)), 'Only one newly generated UI fixture project directly under the system temp directory is allowed');
  assert(lstatSync(projectRoot).isDirectory() && !lstatSync(projectRoot).isSymbolicLink(), 'Fixture project must be a real directory');
  const markerPath = path.join(canonical, MARKER);
  assert(existsSync(markerPath) && lstatSync(markerPath).isFile() && !lstatSync(markerPath).isSymbolicLink(), 'Controlled UI fixture project marker is missing');
  const marker = JSON.parse(readFileSync(markerPath, 'utf8'));
  const ids = fixtureIds(marker.fixtureIdentity ?? '');
  assert(marker.kind === 'slax-ui-fixture-project' && marker.version === 1 && marker.projectRoot === canonical && marker.androidId === ids.androidId && marker.iosId === ids.iosId && marker.scheme === ids.scheme, 'Unrecognized controlled UI fixture project');
  assert(/^[a-z0-9-]+$/.test(marker.scenario) && ['en', 'zh'].includes(marker.locale), 'Invalid controlled fixture scenario or locale');
  return {projectRoot: canonical, marker, ids};
}
function scopedFile(projectRoot, relative) {
  const absolute = path.join(projectRoot, relative), canonical = realpathSync(absolute);
  assert(canonical.startsWith(projectRoot + path.sep) && lstatSync(absolute).isFile() && !lstatSync(absolute).isSymbolicLink(), 'Generated native configuration escaped the fixture project');
  return readFileSync(absolute);
}
function nativeFile(projectRoot, relative) {return scopedFile(projectRoot, relative).toString('utf8');}
function requireFromProject(projectRoot) {return createRequire(path.join(projectRoot, 'package.json'));}
function expoConfig(projectRoot, env) {
  const expoCli = requireFromProject(projectRoot).resolve('expo/bin/cli');
  const result = spawnSync(process.execPath, [expoCli, 'config', '--type', 'prebuild', '--json'], {cwd: projectRoot, env, encoding: 'utf8'});
  assert(result.status === 0, 'Isolated Expo configuration failed; no existing native project was changed');
  return JSON.parse(result.stdout);
}
function verifyConfig(config, ids) {
  assert(config.android?.package === ids.androidId && config.ios?.bundleIdentifier === ids.iosId && config.scheme === ids.scheme, 'UI fixture must use its separate application identities and scheme');
  assert(!config.ios?.entitlements?.['com.apple.security.application-groups']?.length, 'UI fixtures cannot use the production App Group');
  assert(!config.ios?.googleServicesFile && !config.android?.googleServicesFile && !(config.plugins || []).some(plugin => String(Array.isArray(plugin) ? plugin[0] : plugin).includes('with-share')), 'UI fixtures cannot load operator Firebase configuration or generate the inbound share target');
}
/** Read-only validation. It never regenerates or overwrites an existing project. */
export function verifyFixtureProject(projectRoot) {
  const scoped = scopeProject(projectRoot), marker = scoped.marker, ids = scoped.ids;
  assert(Array.isArray(marker.generatedSourceDigests) && marker.generatedSourceDigests.length > FILES.length, 'Fixture prebuild did not complete its source manifest');
  for (const file of marker.generatedSourceDigests) {
    assert(!forbiddenName(path.basename(file.path)) && !path.isAbsolute(file.path) && !file.path.split('/').includes('..'), 'Fixture input manifest contains an unsafe path');
    assert(sha(scopedFile(scoped.projectRoot, file.path)) === file.sha256, `Generated fixture input changed: ${file.path}`);
  }
  const config = expoConfig(scoped.projectRoot, fixtureEnv(marker.scenario, marker.locale, marker.fixtureIdentity)); verifyConfig(config, ids);
  const native = {};
  if (['android', 'all'].includes(marker.platform)) {
    const gradle = nativeFile(scoped.projectRoot, 'android/app/build.gradle'), manifest = nativeFile(scoped.projectRoot, 'android/app/src/main/AndroidManifest.xml');
    assert(new RegExp(`applicationId\\s+['\"]${escapeRegex(ids.androidId)}['\"]`).test(gradle) && new RegExp(`namespace\\s+['\"]${escapeRegex(ids.androidId)}['\"]`).test(gradle), 'Generated Android application identity is incorrect');
    assert(!manifest.includes('ShareActivity') && !manifest.includes('SlaxApiBaseURL'), 'UI fixture contains an inbound share activity/configuration');
    assert(manifest.includes(`android:scheme="${ids.scheme}"`), 'Generated Android fixture scheme is missing');
    assert(/android:name="firebase_analytics_collection_deactivated"[^>]*android:value="true"/.test(manifest) && /android:name="firebase_crashlytics_collection_enabled"[^>]*android:value="false"/.test(manifest), 'Generated Android automatic Firebase collection is enabled');
    native.android = {applicationId: ids.androidId, shareActivity: false, automaticFirebaseCollection: false};
  }
  if (['ios', 'all'].includes(marker.platform)) {
    const names = readdirSync(path.join(scoped.projectRoot, 'ios'));
    const projects = names.filter(name => name.endsWith('.xcodeproj')); assert(projects.length === 1, 'Generated iOS project is ambiguous');
    const project = nativeFile(scoped.projectRoot, `ios/${projects[0]}/project.pbxproj`);
    assert(project.includes(`PRODUCT_BUNDLE_IDENTIFIER = ${ids.iosId};`) || project.includes(`PRODUCT_BUNDLE_IDENTIFIER = "${ids.iosId}";`), 'Generated iOS application identity is incorrect');
    assert(!project.includes('app.slax.reader.share') && !project.includes('SlaxShare') && !names.includes('SlaxShare'), 'UI fixture contains a standalone share target');
    const appDirectory = names.find(name => existsSync(path.join(scoped.projectRoot, 'ios', name, 'Info.plist'))); assert(appDirectory, 'Generated iOS app Info.plist is missing');
    const expoRequire = createRequire(requireFromProject(scoped.projectRoot).resolve('expo/config-plugins'));
    const pluginsRequire = createRequire(expoRequire.resolve('@expo/config-plugins'));
    const plist = pluginsRequire('@expo/plist').default;
    const info = plist.parse(nativeFile(scoped.projectRoot, `ios/${appDirectory}/Info.plist`));
    assert(info.FIREBASE_ANALYTICS_COLLECTION_DEACTIVATED === true && info.FirebaseCrashlyticsCollectionEnabled === false, 'Generated iOS automatic Firebase collection is enabled');
    assert(info.CFBundleURLTypes.some(type => type.CFBundleURLSchemes.includes(ids.scheme)), 'Generated iOS fixture scheme is missing');
    const entitlements = readdirSync(path.join(scoped.projectRoot, 'ios', appDirectory)).filter(name => name.endsWith('.entitlements'));
    for (const file of entitlements) assert(!plist.parse(nativeFile(scoped.projectRoot, `ios/${appDirectory}/${file}`))['com.apple.security.application-groups']?.length, 'Generated iOS UI fixture has an App Group');
    native.ios = {bundleIdentifier: ids.iosId, appGroup: false, shareTarget: false, automaticFirebaseCollection: false};
  }
  return {kind: 'slax-ui-fixture-native-configuration', projectRoot: scoped.projectRoot, scenario: marker.scenario, locale: marker.locale, fixtureIdentity: marker.fixtureIdentity ?? null, native, nativeBuild: false, deviceLaunch: false, sourceRenderParity: false};
}
export function fixtureCommands(projectRoot) {
  const {marker, projectRoot: scoped, ids} = scopeProject(projectRoot);
  const q = value => `'${String(value).replaceAll("'", "'\\''")}'`;
  const env = `EXPO_NO_DOTENV=1 EXPO_NO_TELEMETRY=1 EXPO_NO_METRO_LAZY=1 EXPO_PUBLIC_SLAX_ADOPTION_FIXTURE=0 EXPO_PUBLIC_SLAX_UI_FIXTURE=${q(marker.scenario)} EXPO_PUBLIC_SLAX_UI_FIXTURE_LOCALE=${q(marker.locale)}${marker.fixtureIdentity ? ` EXPO_PUBLIC_SLAX_UI_FIXTURE_ID=${q(marker.fixtureIdentity)}` : ''}`;
  const launchUrl = `${ids.scheme}://expo-development-client/?url=${encodeURIComponent('http://127.0.0.1:8083')}`;
  const commands = {metro: `cd ${q(scoped)}\n${env} node node_modules/expo/bin/cli start --dev-client --port 8083`, verify: `node ${q(path.join(MOBILE_ROOT, 'tooling/fixture-project.mjs'))} --project ${q(scoped)} --verify`};
  if (['android', 'all'].includes(marker.platform)) commands.android = `cd ${q(scoped)}\n${env} node tooling/native-build.mjs android --console=plain\nadb -s "$SLAX_FIXTURE_DEVICE" install -r ${q(path.join(scoped, 'android/app/build/outputs/apk/debug/app-debug.apk'))}\nadb -s "$SLAX_FIXTURE_DEVICE" reverse tcp:8083 tcp:8083\nadb -s "$SLAX_FIXTURE_DEVICE" shell am start -a android.intent.action.VIEW -d ${q(launchUrl)} -p ${ids.androidId}`;
  if (['ios', 'all'].includes(marker.platform)) commands.ios = `cd ${q(scoped)}\n${env} node tooling/native-build.mjs pods\n${env} node tooling/native-build.mjs ios -derivedDataPath ${q(path.join(scoped, 'DerivedData'))}\nxcrun simctl install "$SLAX_FIXTURE_SIMULATOR" ${q(path.join(scoped, 'DerivedData/Build/Products/Debug-iphonesimulator/SlaxReader.app'))}\nxcrun simctl openurl "$SLAX_FIXTURE_SIMULATOR" ${q(launchUrl)}`;
  return commands;
}
export function createFixtureProject({scenario = 'library-populated', locale = 'en', platform = 'all', fixtureIdentity = '', sourceRoot = MOBILE_ROOT} = {}) {
  assert(/^[a-z0-9-]+$/.test(scenario) && ['en', 'zh'].includes(locale) && ['android', 'ios', 'all'].includes(platform), 'Use a known scenario, en/zh locale and android/ios/all platform');
  const ids = fixtureIds(fixtureIdentity);
  const scenarios = JSON.parse(readFileSync(path.join(sourceRoot, 'fixtures/scenarios.json'), 'utf8')); assert(Object.hasOwn(scenarios.scenarios, scenario), 'Unknown UI fixture scenario');
  const source = realpathSync(sourceRoot), files = allowedSourceFiles(source);
  assert(existsSync(path.join(source, 'node_modules/expo/package.json')), 'Install approved mobile dependencies at the repository root first');
  const projectRoot = realpathSync(mkdtempSync(path.join(realpathSync(tmpdir()), PREFIX)));
  const sourceFileDigests = [];
  for (const file of files) {
    const bytes = readFileSync(path.join(source, file)), output = path.join(projectRoot, file);
    mkdirSync(path.dirname(output), {recursive: true}); writeFileSync(output, bytes);
    sourceFileDigests.push({path: file, sha256: sha(bytes)});
  }
  symlinkSync(realpathSync(path.join(source, 'node_modules')), path.join(projectRoot, 'node_modules'), 'dir');
  writeFileSync(path.join(projectRoot, 'metro.config.cjs'), fixtureMetroConfig());
  const marker = {kind: 'slax-ui-fixture-project', version: 1, projectRoot, sourceMobileRoot: source, scenario, locale, platform, fixtureIdentity, androidId: ids.androidId, iosId: ids.iosId, scheme: ids.scheme, sourceFileDigests};
  writeFileSync(path.join(projectRoot, MARKER), JSON.stringify(marker, null, 2) + '\n');
  try {
    const env = fixtureEnv(scenario, locale, fixtureIdentity), config = expoConfig(projectRoot, env); verifyConfig(config, ids);
    assert(!existsSync(path.join(projectRoot, 'android')) && !existsSync(path.join(projectRoot, 'ios')), 'UI fixture native directories must start fresh');
    const result = spawnSync(process.execPath, [requireFromProject(projectRoot).resolve('expo/bin/cli'), 'prebuild', '--no-install', '--platform', platform], {cwd: projectRoot, env, stdio: 'inherit'});
    assert(result.status === 0, 'Isolated Expo prebuild failed; retain the marked fixture for diagnostics');
    marker.generatedSourceDigests = files.map(file => ({path: file, sha256: sha(readFileSync(path.join(projectRoot, file)))}));
    writeFileSync(path.join(projectRoot, MARKER), JSON.stringify(marker, null, 2) + '\n');
    const report = verifyFixtureProject(projectRoot);
    writeFileSync(path.join(projectRoot, 'native-configuration-report.json'), JSON.stringify(report, null, 2) + '\n');
    return {report, commands: fixtureCommands(projectRoot)};
  } catch (error) {throw new Error(`${error instanceof Error ? error.message : 'Fixture generation failed'}\nControlled fixture retained at ${projectRoot}`);}
}
function main(args) {
  const options = {}; let mode = 'create';
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (['--scenario', '--locale', '--platform', '--project', '--identity'].includes(arg)) {assert(args[index + 1], `Missing value for ${arg}`); options[arg === '--identity' ? 'fixtureIdentity' : arg.slice(2)] = args[++index];}
    else if (arg === '--verify') mode = 'verify'; else if (arg === '--commands') mode = 'commands';
    else if (['--help', '-h'].includes(arg)) {console.log('Usage: fixture:project --scenario library-populated --locale en --platform all [--identity lowercase-suffix]\n       fixture:project --project <marked-system-temp-project> --verify|--commands'); return;}
    else throw new Error(`Unknown fixture argument: ${arg}`);
  }
  assert(mode === 'create' ? !options.project : options.project && !options.scenario && !options.locale && !options.platform && !options.fixtureIdentity, 'Creation always uses a fresh temp directory; existing marked projects support read-only verify/commands');
  console.log(JSON.stringify(mode === 'verify' ? verifyFixtureProject(options.project) : mode === 'commands' ? fixtureCommands(options.project) : createFixtureProject(options), null, 2));
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {try {main(process.argv.slice(2));} catch (error) {console.error(error instanceof Error ? error.message : 'Unable to generate fixture project'); process.exitCode = 1;}}
