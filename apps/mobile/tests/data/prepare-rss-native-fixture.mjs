import {createHash} from 'node:crypto';
import {lstatSync, readFileSync, realpathSync, writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const SCENARIO = 'rss-local-native-offline';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
function scopedFile(root, relative) {
  const absolute = path.join(root, relative), canonical = realpathSync(absolute);
  if (!canonical.startsWith(root + path.sep) || !lstatSync(absolute).isFile() || lstatSync(absolute).isSymbolicLink()) throw new Error('RSS acceptance fixture file escaped its task-owned project');
  return absolute;
}

/** Patch only a generated, identity-scoped fixture project to use Expo's SDK 57+ scene delegate. */
export function applyRssNativeSceneShim(projectPath) {
  const root = realpathSync(projectPath), temp = realpathSync(os.tmpdir());
  if (path.dirname(root) !== temp || !/^slax-reader-ui-fixture-[A-Za-z0-9]+$/.test(path.basename(root)) || lstatSync(projectPath).isSymbolicLink()) throw new Error('RSS acceptance scene shim requires a generated direct child of the system temp directory');
  const markerPath = scopedFile(root, '.slax-ui-fixture-project.json');
  const marker = JSON.parse(readFileSync(markerPath, 'utf8'));
  if (marker.kind !== 'slax-ui-fixture-project' || marker.version !== 1 || marker.projectRoot !== root || marker.fixtureIdentity !== 'rssacceptance' || marker.iosId !== 'app.slax.reader.uifixture.rssacceptance') throw new Error('RSS acceptance scene shim requires its task-specific isolated fixture identity');
  const appDelegatePath = scopedFile(root, 'ios/SlaxReader/AppDelegate.swift');
  const infoPlistPath = scopedFile(root, 'ios/SlaxReader/Info.plist');
  let appDelegate = readFileSync(appDelegatePath, 'utf8');
  const legacyWindowStart = '#if os(iOS) || os(tvOS)\n    window = UIWindow(frame: UIScreen.main.bounds)\n    factory.startReactNative(\n      withModuleName: "main",\n      in: window,\n      launchOptions: launchOptions)\n#endif';
  if (appDelegate.includes(legacyWindowStart)) {
    appDelegate = appDelegate.replace('class AppDelegate: ExpoAppDelegate {', 'class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {');
    appDelegate = appDelegate.replace(legacyWindowStart, '');
  } else if (!appDelegate.includes('class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {') || appDelegate.includes('factory.startReactNative(')) {
    throw new Error('RSS acceptance fixture AppDelegate does not match the expected generated Expo template');
  }
  let infoPlist = readFileSync(infoPlistPath, 'utf8');
  if (!infoPlist.includes('<key>UIApplicationSceneManifest</key>')) {
    infoPlist = infoPlist.replace('</dict>\n</plist>', `\t<key>UIApplicationSceneManifest</key>\n\t<dict>\n\t\t<key>UIApplicationSupportsMultipleScenes</key>\n\t\t<false/>\n\t\t<key>UISceneConfigurations</key>\n\t\t<dict>\n\t\t\t<key>UIWindowSceneSessionRoleApplication</key>\n\t\t\t<array>\n\t\t\t\t<dict>\n\t\t\t\t\t<key>UISceneConfigurationName</key>\n\t\t\t\t\t<string>Default Configuration</string>\n\t\t\t\t\t<key>UISceneDelegateClassName</key>\n\t\t\t\t\t<string>EXExpoAppSceneDelegate</string>\n\t\t\t\t</dict>\n\t\t\t</array>\n\t\t</dict>\n\t</dict>\n</dict>\n</plist>`);
  }
  if (!appDelegate.includes('class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {') || appDelegate.includes(legacyWindowStart) || !infoPlist.includes('<string>EXExpoAppSceneDelegate</string>')) throw new Error('Unable to apply the Expo iOS scene lifecycle fixture shim');
  writeFileSync(appDelegatePath, appDelegate);
  writeFileSync(infoPlistPath, infoPlist);
  marker.preparedNativeChanges = [
    {path: 'ios/SlaxReader/AppDelegate.swift', sha256: digest(readFileSync(appDelegatePath))},
    {path: 'ios/SlaxReader/Info.plist', sha256: digest(readFileSync(infoPlistPath))},
  ];
  writeFileSync(markerPath, JSON.stringify(marker, null, 2) + '\n');
  return {nativeSceneShim: 'fixture-only ExpoAppSceneDelegate configuration', preparedNativeChanges: marker.preparedNativeChanges};
}

/** Add closed local RSS rows to a generated, identity-scoped Expo fixture project. */
export function prepareRssNativeFixture(projectPath) {
  const root = realpathSync(projectPath), temp = realpathSync(os.tmpdir());
  if (path.dirname(root) !== temp || !/^slax-reader-ui-fixture-[A-Za-z0-9]+$/.test(path.basename(root)) || lstatSync(projectPath).isSymbolicLink()) throw new Error('RSS acceptance fixture must be a generated direct child of the system temp directory');
  const markerPath = scopedFile(root, '.slax-ui-fixture-project.json');
  const marker = JSON.parse(readFileSync(markerPath, 'utf8'));
  if (marker.kind !== 'slax-ui-fixture-project' || marker.version !== 1 || marker.projectRoot !== root || marker.fixtureIdentity !== 'rssacceptance' || marker.iosId !== 'app.slax.reader.uifixture.rssacceptance') throw new Error('RSS acceptance requires its task-specific isolated fixture identity');
  const scenarioPath = scopedFile(root, 'fixtures/scenarios.json'), manifestPath = scopedFile(root, 'fixtures/manifest.json');
  const scenarios = JSON.parse(readFileSync(scenarioPath, 'utf8'));
  if (Object.hasOwn(scenarios.scenarios, SCENARIO)) throw new Error('RSS acceptance scenario already exists');
  const local = JSON.parse(JSON.stringify(scenarios.scenarios['rss-populated']));
  local.actions = [{kind: 'select-list', list: 'rss'}, {kind: 'select-source', id: 'rss-alpha'}];
  const payload = local.payload;
  payload.network = {isConnected: false, isInternetReachable: false};
  payload.sync = {connected: false, connecting: true, downloading: true, uploading: false, hasSynced: false};
  for (const route of payload.api) {
    if (route.path === '/v1/user/labs' || route.path === '/v1/rss/subscriptions' || route.path === '/v1/rss/entries') {
      route.status = 503;
      route.json = {code: 503, message: 'network_unavailable', data: {error: 'network_unavailable'}};
    }
  }
  const savedBookmark = JSON.parse(JSON.stringify(payload.database.sr_user_bookmark[0]));
  savedBookmark.id = 'rss-saved-bookmark'; savedBookmark.user_id = payload.session.userId;
  const metadata = JSON.parse(savedBookmark.metadata);
  metadata.bookmark = {...metadata.bookmark, uuid: savedBookmark.id, title: 'Native RSS saved fixture', target_url: 'https://fixture-pages.test/rss-alpha-saved'};
  savedBookmark.metadata = JSON.stringify(metadata); payload.database.sr_user_bookmark.push(savedBookmark);
  payload.database.sr_rss_subscription = [
    {id: 'rss-alpha', feed_id: 'rss-feed-alpha', remark: 'Alpha local source', created_at: '2026-10-10T04:00:00Z'},
    {id: 'rss-beta', feed_id: 'rss-feed-beta', remark: 'Beta local source', created_at: '2026-10-10T04:01:00Z'},
  ];
  const dates = {last_checked_at: '2026-10-10T04:00:00Z', last_success_at: '2026-10-10T04:00:00Z', next_fetch_at: '2080-01-01T00:00:00Z', next_allowed_at: '2000-01-01T00:00:00Z', error: null, refreshing_until: null};
  payload.database.sr_rss_feed = [
    {id: 'rss-feed-alpha', feed_url: 'https://fixture-pages.test/alpha.xml', title: 'Alpha Feed', site_url: 'https://fixture-pages.test', icon_url: null, ...dates},
    {id: 'rss-feed-beta', feed_url: 'https://fixture-pages.test/beta.xml', title: 'Beta Feed', site_url: 'https://fixture-pages.test', icon_url: null, ...dates},
  ];
  payload.database.sr_rss_entry = [
    {id: 'rss-alpha-unsaved', feed_id: 'rss-feed-alpha', title: 'Alpha cached unsaved article', author: 'Local fixture author', summary: 'Read from PowerSync SQLite while offline.', article_url: 'https://fixture-pages.test/rss-alpha-unsaved', image_url: null, published_at: '2026-10-10T03:00:00Z', first_seen_at: '2026-10-10T04:00:00Z', sort_at: '2026-10-10T04:00:00Z', content_truncated: 0},
    {id: 'rss-alpha-saved', feed_id: 'rss-feed-alpha', title: 'Alpha cached saved article', author: 'Local fixture author', summary: 'Saved state joins from local bookmarks.', article_url: 'https://fixture-pages.test/rss-alpha-saved', image_url: null, published_at: '2026-10-10T02:00:00Z', first_seen_at: '2026-10-10T04:00:00Z', sort_at: '2026-10-10T03:00:00Z', content_truncated: 0},
    {id: 'rss-beta-entry', feed_id: 'rss-feed-beta', title: 'Beta cached article', author: 'Local fixture author', summary: 'Source switching must isolate this row.', article_url: 'https://fixture-pages.test/rss-beta', image_url: null, published_at: '2026-10-10T01:00:00Z', first_seen_at: '2026-10-10T04:00:00Z', sort_at: '2026-10-10T02:00:00Z', content_truncated: 0},
  ];
  scenarios.scenarios[SCENARIO] = local;
  writeFileSync(scenarioPath, JSON.stringify(scenarios, null, 2) + '\n');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const scenarioSha256 = digest(readFileSync(scenarioPath));
  manifest.files = manifest.files.map(file => file.path === 'scenarios.json' ? {...file, sha256: scenarioSha256} : file);
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  const manifestSha256 = digest(readFileSync(manifestPath));
  marker.scenario = SCENARIO;
  marker.generatedSourceDigests = (marker.generatedSourceDigests ?? []).map(file => file.path === 'fixtures/scenarios.json' ? {...file, sha256: scenarioSha256} : file.path === 'fixtures/manifest.json' ? {...file, sha256: manifestSha256} : file);
  const sceneShim = applyRssNativeSceneShim(root);
  marker.preparedNativeChanges = sceneShim.preparedNativeChanges;
  writeFileSync(markerPath, JSON.stringify(marker, null, 2) + '\n');
  return {project: root, scenario: SCENARIO, scenarioSha256, seeded: {subscriptions: 2, feeds: 2, entries: 3, savedBookmarks: 1}, network: payload.network, sync: payload.sync, networkResponses: 'Labs, subscriptions and REST entries return synthetic 503 responses', nativeSceneShim: sceneShim.nativeSceneShim};
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {console.log(JSON.stringify(prepareRssNativeFixture(process.argv[2]), null, 2));}
  catch (error) {console.error(error instanceof Error ? error.message : 'Unable to prepare RSS acceptance fixture'); process.exitCode = 1;}
}
