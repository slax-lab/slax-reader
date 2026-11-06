import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';
import React, {act} from 'react';
import {countingObserve, observeRelativeBoundaries, readiness} from '../reader/observe-mock.mjs';
import * as sourceUrls from '../../src/utils/source-url.ts';

const require = createRequire(import.meta.url);
const domPath = require.resolve('happy-dom', {paths: [new URL('../../../../node_modules/.pnpm/node_modules/', import.meta.url).pathname]});
async function load(file, boundaries = {}, globals = {}) {
  const passthrough = ({children}) => children ?? null;
  const drawer = {SourceDrawer: passthrough};
  boundaries = {'./SourceDrawer': drawer, '../components/SourceDrawer': drawer, '../components/SearchGlyph': {SearchGlyph: () => null}, '../utils/source-url': sourceUrls,
    ...observeRelativeBoundaries(boundaries), ...boundaries};
  const code = ts.transpileModule(await readFile(new URL(file, import.meta.url), 'utf8'), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true},
  }).outputText;
  const exports = {};
  vm.runInNewContext(code, {exports, __DEV__: false, AbortController, setTimeout, clearTimeout, setInterval, clearInterval, ...globals, require: name => {assert.ok(Object.hasOwn(boundaries, name), name); return boundaries[name];}});
  return exports;
}
const theme = await load('../../src/theme/index.ts');
const contracts = await load('../../../../packages/contracts/src/pdf.ts');
const {PDF_MAX_BYTES} = contracts;
const deferred = () => {let resolve, reject; const promise = new Promise((yes, no) => {resolve = yes; reject = no;}); return {promise, resolve, reject};};
const nil = () => null;
async function mounted(run) {
  const {Window} = await import(pathToFileURL(domPath).href);
  const window = new Window(), names = ['window', 'document', 'navigator', 'HTMLElement', 'IS_REACT_ACT_ENVIRONMENT'];
  const previous = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const name of names) Object.defineProperty(globalThis, name, {value: name === 'IS_REACT_ACT_ENVIRONMENT' ? true : name === 'window' ? window : window[name], configurable: true, writable: true});
  const {createRoot} = await import('react-dom/client');
  const root = createRoot(window.document.body.appendChild(window.document.createElement('div')));
  try {await run(root);} finally {
    await act(async () => root.unmount()); window.close();
    for (const name of names) {const old = previous.get(name); if (old) Object.defineProperty(globalThis, name, old); else delete globalThis[name];}
  }
}
function views() {
  const nodes = new Map(), commands = [];
  const native = (name, modal = false) => React.forwardRef((props, ref) => {
    const key = React.useRef(Symbol(name)).current;
    React.useLayoutEffect(() => {nodes.set(key, {name, props}); return () => nodes.delete(key);});
    React.useImperativeHandle(ref, () => ({focus() {commands.push('focus');}, blur() {commands.push('blur');}, scrollToOffset() {}}), []);
    return React.createElement('div', null, modal && !props.visible ? null : name === 'FlatList' ? props.ListHeaderComponent : props.children);
  });
  const all = name => [...nodes.values()].filter(node => node.name === name).map(node => node.props);
  return {commands, native, all, one(name, predicate = () => true) {const matches = all(name).filter(predicate); assert.equal(matches.length, 1, `${name}: expected one node, got ${matches.length}`); return matches[0];},
    primitives: Object.fromEntries(['View', 'Text', 'Pressable', 'TextInput', 'ScrollView', 'FlatList'].map(name => [name, native(name)])),
    ui: {...Object.fromEntries(['SourceButton', 'SourceText', 'SourceIcon', 'TextAction', 'SourceSwitch', 'ScreenSurface', 'Divider', 'SourceProgress'].map(name => [name, native(name)])), SourceDialog: native('SourceDialog', true)},
  };
}
function clock() {
  let now = 0, next = 0;
  const tasks = new Map();
  return {setTimeout(callback, delay) {const id = ++next; tasks.set(id, {at: now + delay, callback}); return id;}, clearTimeout(id) {tasks.delete(id);}, advance(milliseconds) {now += milliseconds; for (const [id, task] of [...tasks]) if (task.at <= now) {tasks.delete(id); task.callback();}}};
}
async function harness(root, platform = 'ios', development = false) {
  const v = views(), timers = clock(), listeners = new Set();
  const h = {v, timers, owner: 'account-a', focused: true, visible: true, selected: {uri: 'file:///cache/selected.pdf', name: 'Résumé.pdf', size: 1024}, pickCalls: 0, removed: [], files: [], labsCalls: [], uploads: [], watches: [], bookmarkWatches: [], saved: [], dismissals: 0, changes: [], navigations: [], reset: [], created: [], clipboard: '', clipboardCalls: 0};
  h.labs = async () => ({features: [{key: 'pdf', enabled: true}, {key: 'rss', enabled: false}]});
  h.upload = async () => ({bookmark_uid: 'server-pdf'});
  h.pick = async () => h.selected;
  h.setLab = async () => {};
  class File {
    constructor(uri) {this.uri = uri; Object.assign(this, {exists: true, size: h.selected?.size ?? 1024}, h.fileMetadata); h.files.push(this);}
    base64() {assert.fail('PDF import must not base64-encode the native File');}
    bytes() {assert.fail('PDF import must not materialize the native File bytes');}
  }
  h.File = File;
  const api = {
    rssLabs(signal) {h.labsCalls.push(signal); return h.labs(signal);},
    uploadPdf(...args) {h.uploads.push(args); return h.upload(...args);},
    setLab(...args) {h.changes.push(args); return h.setLab(...args);},
    rssEnable: async () => {},
  };
  const repositories = {
    watchRows(sql, params, rows, error) {const watch = {sql, params, rows, error, stopped: 0}; h.watches.push(watch); return () => {watch.stopped++;};},
    watchBookmarks(sort, rows) {const watch = {sort, rows, stopped: 0}; h.bookmarkWatches.push(watch); return () => {watch.stopped++;};},
    library: {watch(sort, _owner, rows) {const watch = {sort, rows, stopped: 0}; h.bookmarkWatches.push(watch); return () => {watch.stopped++;};}},
    watchLibraryCollections: () => () => {}, watchLibraryUser: () => () => {},
    watchCollections: () => () => {}, watchUser: () => () => {}, watchSubscription: () => () => {},
    createBookmark: async url => {h.created.push(url);},
  };
  const runtime = {getNativeResourceOwner: () => h.owner, getDatabase: () => null};
  const mobile = {t: value => value, api, repositories, runtime, preferences: {read: async () => ({}), update: async () => {}}, sessions: {}, settings: {}, locale: 'en', config: {platform}, upgrade: {status: 'ready'}};
  Object.assign(runtime, {getRepositories: () => repositories, getAccountPreferences: () => mobile.preferences, getUpgradeSnapshot: () => mobile.upgrade});
  const useMobile = () => ({...mobile, nativeResourceOwner: h.owner, fixtureOnly: h.fixtureOnly});
  const navigation = {useFocusEffect: callback => React.useEffect(() => h.focused ? callback() : undefined, [callback, h.focused])};
  const native = {...v.primitives, Platform: {OS: platform, select: values => values[platform] ?? values.default}, StyleSheet: {create: value => value, absoluteFill: {}}, PixelRatio: {roundToNearestPixel: value => value}, Animated: {}, Linking: {}, useWindowDimensions: () => ({width: 375, height: 800, fontScale: 1}), AppState: {currentState: 'active', addEventListener(name, callback) {assert.equal(name, 'change'); listeners.add(callback); return {remove() {listeners.delete(callback);}};}}};
  const labsCache = await load('../../src/settings/labs-cache.ts');
  const common = {react: React, 'react-native': native, '../runtime': {useMobile, useMobileSettings: () => mobile.settings}, '../theme': theme, '../theme/testIds': {mobileTestIds: {AddLinkDialog: 'add-link', AddLinkError: 'link-error'}}, './SourceUI': v.ui, '../settings/labs-cache': labsCache};
  const {PdfImportDialog} = await load('../../src/components/PdfImportDialog.tsx', {...common, 'expo-file-system': {File}, '@slax-reader/contracts/pdf': contracts, '../native/pdf-import': {pickPdf() {h.pickCalls++; return h.pick();}, removePickedPdf: async uri => {h.removed.push(uri);}}}, {...timers, __DEV__: development});
  const {LinkInputDialog} = await load('../../src/components/LinkInputDialog.tsx', {...common, 'expo-clipboard': {getStringAsync: async () => {h.clipboardCalls++; return h.clipboard;}}}, timers);
  const {usePdfLab} = await load('../../src/pdf/usePdfLab.ts', {...common, '@react-navigation/native': navigation});
  h.render = () => root.render(React.createElement(PdfImportDialog, {key: h.owner, visible: h.visible, onDismiss() {h.dismissals++; h.visible = false; h.render();}, onSaved: id => h.saved.push(id)}));
  h.dialog = () => v.one('SourceDialog', props => props.title === 'pdf_import_title');
  h.hasText = value => v.all('SourceText').some(props => props.children === value);
  h.button = label => v.one('SourceButton', props => props.label === label);
  h.action = label => v.one('TextAction', props => props.label === label);
  h.choose = async () => {
    await act(async () => h.action('pdf_pick').onPress());
    assert.equal(h.dialog().visible, false);
    await act(async () => platform === 'ios' ? h.dialog().onDidDismiss() : timers.advance(250));
  };
  h.submit = () => act(async () => h.button('pdf_upload').onPress());
  h.background = state => act(async () => {native.AppState.currentState = state; for (const callback of listeners) callback(state);});
  h.listenerCount = () => listeners.size;
  h.loadLibrary = async () => {
    const observe = await countingObserve(load);
    h.observeCounter = observe.counter;
    const rssState = {enabled: false};
    class RssController {subscribe = () => () => {}; getSnapshot = () => rssState; activate() {} dispose() {} cancel() {} poll() {} async load() {}}
    class FeedScrollPosition {reset() {}}
    const reset = value => h.reset.push(value);
    const {LibraryScreen} = await load('../../src/screens/LibraryScreen.tsx', {
      ...common, './LibraryDataStatus': {LibraryDataStatus: nil}, '@react-navigation/native': navigation, 'react-native-safe-area-context': {useSafeAreaInsets: () => ({top: 44, bottom: 34})}, 'expo-network': {useNetworkState: () => ({isConnected: true})},
      '../telemetry': {useTelemetry: () => telemetry}, '../components/LibrarySyncAvatar': {LibrarySyncAvatar: nil}, '../components/LibrarySyncStatus': {LibrarySyncStatus: nil}, '../components/SourceSyncAvatar': {SourceSyncAvatar: nil}, '../components/SourceLine': {SourceLine: nil}, '../components/SourceRing': {SourceCircle: nil}, '../components/SourceShape': {SourceShape: v.native('SourceShape')}, '../components/sync-state': {sourceSyncState: () => ({kind: 'idle'})}, '../components/fixture-actions': {},
      '../components': {...v.ui, BookmarkRow: nil, LinkInputDialog, RssFeed: nil, RssFeedSwitcher: nil, SourceAvatar: nil, SourceMenu: props => {h.sortMenu = props; return null;}}, '../components/useVisibleSnapshot': await load('../../src/components/useVisibleSnapshot.ts', {react: React}), '../data': {readContinueReading: async () => null}, '../rss/controller': {RssController}, './collection-selection': await load('../../src/screens/collection-selection.ts'), '../components/feed-scroll': {FeedScrollPosition, useFeedScrollPosition: () => ({events: {}, reset})}, '../components/SourceDrawer': {SourceDrawer: v.native('SourceDrawer')}, '../components/FeedList': {FeedList: props => React.createElement(v.primitives.FlatList, props)}, '../components/useAppForeground': await load('../../src/components/useAppForeground.ts', {react: React, 'react-native': native}), '../utils/source-time': await load('../../src/utils/source-time.ts'), '../components/PdfImportDialog': {PdfImportDialog}, '../pdf/usePdfLab': {usePdfLab},
      '../observe': observe.module, '../observe/readiness': readiness,
    });
    const navigator = {navigate: (...args) => h.navigations.push(args)};
    h.render = () => root.render(React.createElement(LibraryScreen, {navigation: navigator, route: {params: {}}}));
    await act(async () => h.render());
  };
  h.openLibraryImport = async () => {
    await act(async () => v.one('Pressable', props => props.accessibilityLabel === 'Add Link').onPress());
    await act(async () => h.action('pdf_add_file').onPress());
    const link = v.one('SourceDialog', props => props.testID === 'add-link' && React.Children.toArray(props.children).some(child => child.props.testID === 'add-pdf-file'));
    assert.equal(link.visible, false); assert.equal(h.dialog().visible, false);
    await act(async () => platform === 'ios' ? link.onDidDismiss() : timers.advance(200));
    assert.equal(h.dialog().visible, true);
  };
  h.loadSettings = async () => {
    mobile.session = {status: 'authenticated', session: {userId: 'settings-user'}};
    mobile.sessions = {getSnapshot: () => mobile.session, captureIdentity: () => () => {}};
    const scope = await load('../../src/settings/account-scope.ts', {react: React});
    const surfacePreferences = await load('../../src/settings/system-surface-preferences.ts');
    const settingsState = await load('../../src/settings/useSettingsState.ts', {react: React, './system-surface-preferences': surfacePreferences});
    const rssLab = await load('../../src/settings/useRssLab.ts', {...common, '@react-navigation/native': navigation, './labs-cache': labsCache});
    const settingsView = await load('../../src/settings/SettingsView.tsx', {...common, '../components': v.ui, '../components/SourceParagraph': {SourceParagraph: nil}});
    const {SettingsScreen} = await load('../../src/screens/SettingsScreen.tsx', {
      ...common, '../pdf/usePdfLab': {usePdfLab}, '../settings/account-scope': scope,
      '../settings/useSettingsState': settingsState, '../settings/useRssLab': rssLab, '../settings/SettingsView': settingsView,
    });
    const navigator = {setOptions() {}, navigate() {}};
    h.render = () => root.render(React.createElement(SettingsScreen, {navigation: navigator}));
    await act(async () => h.render());
  };
  h.loadHook = async () => {
    function Probe() {h.labState = usePdfLab(); return null;}
    h.render = () => root.render(React.createElement(Probe));
    await act(async () => h.render());
  };
  h.LinkInputDialog = LinkInputDialog;
  return h;
}
const telemetry = {track() {}, element() {}, firebase() {}};

for (const platform of ['ios', 'android']) test(`${platform} picker waits for modal dismissal, null cancellation restores the dialog without error`, async () => mounted(async root => {
  const h = await harness(root, platform); h.selected = null;
  await act(async () => h.render());
  assert.equal(h.button('pdf_upload').disabled, true);
  await act(async () => h.action('pdf_pick').onPress());
  assert.equal(h.dialog().visible, false); assert.equal(h.pickCalls, 0);
  await act(async () => h.timers.advance(platform === 'ios' ? 1000 : 249));
  assert.equal(h.pickCalls, 0, 'Never overlap the document picker with the outgoing modal');
  await act(async () => platform === 'ios' ? h.dialog().onDidDismiss() : h.timers.advance(1));
  assert.equal(h.pickCalls, 1); assert.equal(h.dialog().visible, true); assert.equal(h.button('pdf_upload').disabled, true);
  assert.equal(h.hasText('pdf_pick_failed'), false); assert.deepEqual(h.removed, []); assert.deepEqual(h.uploads, []);
}));

test('picker cancellation retains an earlier selection; replacing and closing release each temporary file once', async () => mounted(async root => {
  const h = await harness(root); await act(async () => h.render()); await h.choose();
  const first = h.selected; h.selected = null; await h.choose();
  assert.equal(h.hasText(first.name), true); assert.deepEqual(h.removed, []);
  h.selected = {uri: 'file:///cache/replacement.pdf', name: 'Replacement.pdf', size: 2048}; await h.choose();
  assert.deepEqual(h.removed, [first.uri]); assert.equal(h.hasText('Replacement.pdf'), true);
  await act(async () => h.action('btn_close').onPress());
  assert.deepEqual(h.removed, [first.uri, h.selected.uri]); assert.equal(h.dialog().visible, false);
  await act(async () => root.render(null)); assert.equal(h.removed.length, 2); assert.equal(h.listenerCount(), 0);
}));

for (const size of [0, -1, 1.5, NaN, PDF_MAX_BYTES + 1]) test(`picker size ${size} is rejected before Labs or file IO`, async () => mounted(async root => {
  const h = await harness(root); h.selected.size = size;
  await act(async () => h.render()); await h.choose(); await h.submit();
  assert.equal(h.hasText('pdf_size_invalid'), true); assert.equal(h.labsCalls.length, 0); assert.equal(h.files.length, 0); assert.equal(h.uploads.length, 0);
}));

for (const metadata of [{exists: false}, {size: 0}, {size: PDF_MAX_BYTES + 1}]) test(`native File metadata ${JSON.stringify(metadata)} blocks upload after Labs preflight`, async () => mounted(async root => {
  const h = await harness(root); h.fileMetadata = metadata;
  await act(async () => h.render()); await h.choose(); await h.submit();
  assert.equal(h.hasText('pdf_size_invalid'), true); assert.equal(h.labsCalls.length, 1); assert.equal(h.files.length, 1); assert.equal(h.uploads.length, 0); assert.deepEqual(h.removed, []);
}));

for (const failure of ['disabled', 'unavailable', 'upload']) test(`${failure} rejection retains the file and a retry rechecks Labs without repicking`, async () => mounted(async root => {
  const h = await harness(root);
  if (failure === 'disabled') h.labs = async () => ({features: [{key: 'rss', enabled: true}, {key: 'pdf', enabled: false}]});
  if (failure === 'unavailable') h.labs = async () => {throw new Error('Labs unavailable');};
  if (failure === 'upload') h.upload = async () => {throw new Error('Upload failed');};
  await act(async () => h.render()); await h.choose(); await h.submit();
  assert.equal(h.hasText(failure === 'disabled' ? 'pdf_lab_disabled' : 'pdf_upload_failed'), true);
  assert.equal(h.hasText(h.selected.name), true); assert.equal(h.button('pdf_upload').busy, false); assert.deepEqual(h.removed, []);
  assert.equal(h.uploads.length, failure === 'upload' ? 1 : 0); assert.equal(h.watches.length, 0);
  h.labs = async () => ({features: [{key: 'pdf', enabled: true}]}); h.upload = async () => ({bookmark_uid: 'server-retry'});
  await h.submit();
  assert.equal(h.pickCalls, 1); assert.equal(h.labsCalls.length, 2); assert.deepEqual(h.removed, [h.selected.uri]);
  assert.equal(h.watches.length, 1); assert.deepEqual(Array.from(h.watches[0].params), ['server-retry']); assert.deepEqual(h.saved, []);
}));

test('Library marks interactive once per mount through the real hook, not again after a sort switch', async () => mounted(async root => {
  const h = await harness(root);
  await h.loadLibrary();
  assert.equal(h.observeCounter.marks, 0, 'Loading rows are not interactive');
  await act(async () => h.bookmarkWatches.at(-1).rows([]));
  assert.equal(h.observeCounter.marks, 1, 'An empty first snapshot is a usable surface');
  await act(async () => h.render());
  assert.equal(h.observeCounter.marks, 1, 'Re-renders do not re-mark');
  await act(async () => h.sortMenu.items.find(item => !item.selected).onPress());
  const switched = h.bookmarkWatches.at(-1);
  assert.notEqual(switched.sort, 'inbox', 'The sort switch starts a new rows watch');
  await act(async () => switched.rows([]));
  assert.equal(h.observeCounter.marks, 1, 'A sort switch resetting rowsReady must not report a late second TTI');
}));

for (const platform of ['ios', 'android']) test(`${platform} Library uploads a raw File at the inclusive limit and navigates only after the server row watcher`, async () => mounted(async root => {
  const h = await harness(root, platform), upload = deferred(); h.selected.size = PDF_MAX_BYTES; h.upload = () => upload.promise;
  await h.loadLibrary(); await h.openLibraryImport(); await h.choose(); await h.submit();
  assert.equal(h.uploads.length, 1);
  const [body, filename, signal] = h.uploads[0];
  assert.ok(body instanceof h.File); assert.equal(body, h.files[0]); assert.equal(body.uri, h.selected.uri); assert.equal(filename, h.selected.name); assert.equal(signal, h.labsCalls.at(-1));
  assert.equal(h.button('pdf_uploading').busy, true); assert.equal(h.action('pdf_pick').disabled, true);
  assert.deepEqual(h.navigations, []); assert.equal(h.watches.length, 0);
  await act(async () => upload.resolve({bookmark_uid: 'server-pdf'}));
  assert.equal(h.hasText('pdf_upload_complete'), true); assert.equal(h.hasText('pdf_upload_sync_pending'), true);
  assert.deepEqual(h.removed, [h.selected.uri]); assert.deepEqual(h.navigations, []); assert.deepEqual(h.created, []);
  const watch = h.watches[0]; assert.equal(watch.sql, 'SELECT id FROM sr_user_bookmark WHERE id = ?'); assert.deepEqual(Array.from(watch.params), ['server-pdf']);
  await act(async () => watch.rows([])); assert.deepEqual(h.navigations, []); assert.equal(h.dialog().visible, true);
  await act(async () => watch.rows([{id: 'server-pdf'}])); assert.equal(h.dialog().visible, false);
  if (platform === 'ios') {assert.deepEqual(h.navigations, []); await act(async () => h.dialog().onDidDismiss());}
  assert.deepEqual(h.navigations.map(([route, params]) => [route, {...params}]), [['Reader', {bookmarkId: 'server-pdf'}]]);
  assert.equal(h.reset.at(-1), true); assert.equal(watch.stopped, 1);
  await act(async () => {watch.rows([{id: 'server-pdf'}]); h.dialog().onDidDismiss();}); assert.equal(h.navigations.length, 1);
}));

for (const stage of ['Labs', 'upload']) test(`backgrounding during ${stage} aborts the request, suppresses late success, and retains a retryable file`, async () => mounted(async root => {
  const h = await harness(root), pending = deferred();
  if (stage === 'Labs') h.labs = () => pending.promise; else h.upload = () => pending.promise;
  await act(async () => h.render()); await h.choose(); await h.submit();
  const signal = h.labsCalls[0]; assert.equal(signal.aborted, false);
  await h.background('inactive'); assert.equal(signal.aborted, true); assert.equal(h.dialog().visible, false);
  await h.background('active'); assert.equal(h.hasText('pdf_upload_background'), true);
  assert.equal(h.button('pdf_upload').busy, false); assert.equal(h.hasText(h.selected.name), true); assert.deepEqual(h.removed, []);
  await act(async () => pending.resolve(stage === 'Labs' ? {features: [{key: 'pdf', enabled: true}]} : {bookmark_uid: 'late-result'}));
  assert.equal(h.watches.length, 0); assert.deepEqual(h.saved, []); assert.equal(h.uploads.length, stage === 'Labs' ? 0 : 1);
  h.labs = async () => ({features: [{key: 'pdf', enabled: true}]}); h.upload = async () => ({bookmark_uid: 'retry-result'});
  await h.background('active'); await h.submit();
  assert.equal(h.pickCalls, 1); assert.equal(h.labsCalls.at(-1).aborted, false); assert.deepEqual(Array.from(h.watches[0].params), ['retry-result']);
}));

for (const transition of ['close', 'account change', 'unmount']) test(`${transition} while picking removes a late native selection without uploading or reopening`, async () => mounted(async root => {
  const h = await harness(root), picker = deferred(); h.pick = () => picker.promise;
  await act(async () => h.render()); await h.choose();
  if (transition === 'close') {h.visible = false; await act(async () => h.render());}
  else if (transition === 'account change') {h.owner = 'account-b'; await act(async () => h.render());}
  else await act(async () => root.render(null));
  await act(async () => picker.resolve(h.selected));
  assert.deepEqual(h.removed, [h.selected.uri]); assert.equal(h.uploads.length, 0); assert.deepEqual(h.saved, []);
  if (transition === 'account change') assert.equal(h.button('pdf_upload').disabled, true);
  if (transition === 'close') assert.equal(h.dialog().visible, false);
  if (transition === 'unmount') assert.equal(h.listenerCount(), 0);
}));

for (const transition of ['account change', 'unmount']) test(`Library ${transition} aborts uploads and releases account-owned files without stale navigation`, async () => mounted(async root => {
  const h = await harness(root), upload = deferred(); h.upload = () => upload.promise;
  await h.loadLibrary(); await h.openLibraryImport(); await h.choose(); await h.submit();
  const signal = h.uploads[0][2];
  if (transition === 'account change') {h.owner = 'account-b'; await act(async () => h.render());} else await act(async () => root.render(null));
  assert.equal(signal.aborted, true); assert.deepEqual(h.removed, [h.selected.uri]);
  await act(async () => upload.resolve({bookmark_uid: 'old-account-result'}));
  assert.equal(h.watches.length, 0); assert.deepEqual(h.navigations, []);
  if (transition === 'account change') {
    assert.equal(h.dialog().visible, false);
    await h.openLibraryImport(); assert.equal(h.button('pdf_upload').disabled, true);
  } else assert.equal(h.listenerCount(), 0);
}));

test('unmount while awaiting synchronization unsubscribes and fences late watcher callbacks', async () => mounted(async root => {
  const h = await harness(root); await act(async () => h.render()); await h.choose(); await h.submit();
  const watch = h.watches[0]; await act(async () => root.render(null));
  assert.equal(watch.stopped, 1); assert.equal(h.listenerCount(), 0); assert.deepEqual(h.removed, [h.selected.uri]);
  await act(async () => watch.rows([{id: 'server-pdf'}])); assert.deepEqual(h.saved, []); assert.equal(h.dismissals, 0);
}));

test('PDF Labs hook aborts old account/focus requests, rejects stale results and reloads on focus', async () => mounted(async root => {
  const h = await harness(root), first = deferred(), second = deferred(); let call = 0;
  h.labs = () => (++call === 1 ? first.promise : second.promise);
  await h.loadHook(); assert.equal(h.labState.ready, false); assert.equal(h.labState.busy, true);
  h.owner = 'account-b'; await act(async () => h.render()); assert.equal(h.labsCalls[0].aborted, true); assert.equal(h.labsCalls.length, 2);
  await act(async () => first.resolve({features: [{key: 'pdf', enabled: true}]})); assert.equal(h.labState.enabled, false); assert.equal(h.labState.ready, false);
  await act(async () => second.resolve({features: [{key: 'rss', enabled: true}]})); assert.equal(h.labState.enabled, false); assert.equal(h.labState.ready, true);
  const pending = deferred(); h.labs = () => pending.promise;
  await act(async () => {void h.labState.load();}); h.focused = false; await act(async () => h.render());
  assert.equal(h.labsCalls.at(-1).aborted, true);
  await act(async () => pending.resolve({features: [{key: 'pdf', enabled: true}]})); assert.equal(h.labState.enabled, false);
  h.labs = async () => ({features: [{key: 'pdf', enabled: true}]}); h.focused = true; await act(async () => h.render());
  assert.equal(h.labState.enabled, true); assert.equal(h.labState.busy, false);
}));

test('PDF Labs retains admitted state during a same-owner refocus refresh', async () => mounted(async root => {
  const h = await harness(root);
  h.labs = async () => ({features: [{key: 'pdf', enabled: true}]});
  await h.loadHook(); assert.equal(h.labState.ready, true); assert.equal(h.labState.enabled, true);
  h.focused = false; await act(async () => h.render());
  const pending = deferred(); h.labs = () => pending.promise;
  h.focused = true; await act(async () => h.render());
  assert.equal(h.labState.ready, true); assert.equal(h.labState.enabled, true); assert.equal(h.labState.busy, true);
  await act(async () => pending.resolve({features: []}));
  assert.equal(h.labState.enabled, false); assert.equal(h.labState.busy, false);
}));

test('Settings PDF switch uses server state, disables while changing, and offers retry after Labs rejection', async () => mounted(async root => {
  const h = await harness(root); h.labs = async () => ({features: [{key: 'pdf', enabled: false}]});
  await h.loadSettings(); const toggle = () => h.v.one('SourceSwitch', props => props.label === 'pdf_title');
  assert.equal(toggle().value, false); assert.equal(toggle().disabled, false);
  const mutation = deferred(); h.setLab = () => mutation.promise;
  await act(async () => toggle().onChange(true));
  assert.equal(toggle().value, false); assert.equal(toggle().disabled, true); assert.deepEqual(h.changes[0].slice(0, 2), ['pdf', true]);
  await act(async () => mutation.reject(new Error('Server rejected Labs update')));
  assert.equal(toggle().value, false); assert.equal(toggle().disabled, false); assert.equal(h.hasText('pdf_labs_error'), true);
  h.labs = async () => ({features: [{key: 'pdf', enabled: true}]});
  await act(async () => h.action('rss_retry').onPress());
  assert.equal(toggle().value, true); assert.equal(h.hasText('pdf_labs_error'), false);
  h.setLab = async () => {}; await act(async () => toggle().onChange(false));
  assert.deepEqual(h.changes[1].slice(0, 2), ['pdf', false]); assert.equal(toggle().value, true, 'A successful mutation still uses the server Labs snapshot, not optimistic local state');
}));

test('Library hides import until Labs grants PDF, then preserves manual URL validation and submission', async () => mounted(async root => {
  const h = await harness(root), pending = deferred(); h.labs = () => pending.promise;
  await h.loadLibrary(); await act(async () => h.v.one('Pressable', props => props.accessibilityLabel === 'Add Link').onPress());
  assert.equal(h.v.all('TextAction').some(props => props.label === 'pdf_add_file'), false);
  await act(async () => pending.resolve({features: [{key: 'pdf', enabled: false}]}));
  assert.equal(h.v.all('TextAction').some(props => props.label === 'pdf_add_file'), false);
  h.focused = false; await act(async () => h.render());
  h.labs = async () => ({features: [{key: 'pdf', enabled: true}]}); h.focused = true; await act(async () => h.render());
  assert.equal(h.action('pdf_add_file').testID, 'add-pdf-file');
  await act(async () => h.v.one('TextInput').onChangeText('not a URL')); await act(async () => h.button('add_link_btn_submit').onPress());
  assert.equal(h.hasText('add_link_error_invalid_url'), true); assert.deepEqual(h.created, []);
  await act(async () => h.v.one('TextInput').onChangeText('  https://source.test/article  ')); await act(async () => h.v.one('TextInput').onSubmitEditing());
  assert.deepEqual(h.created, ['https://source.test/article']); assert.equal(h.reset.at(-1), true);
  assert.equal(h.v.one('SourceDialog', props => props.testID === 'add-link' && React.Children.toArray(props.children).some(child => child.props.testID === 'add-pdf-file')).visible, false); assert.equal(h.dialog().visible, false); assert.equal(h.pickCalls, 0);
}));

test('Library stops bookmark watches while blurred or backgrounded and keeps the last rows visible', async () => mounted(async root => {
  const h = await harness(root); await h.loadLibrary();
  const live = () => h.bookmarkWatches.filter(watch => !watch.stopped);
  const shown = () => Array.from(h.v.one('FlatList').data, row => row.id);
  assert.equal(live().length, 1); assert.equal(live()[0].sort, 'inbox');
  await act(async () => live()[0].rows([{id: 'first'}]));
  assert.deepEqual(shown(), ['first']);
  h.focused = false; await act(async () => h.render());
  assert.equal(live().length, 0, 'A blurred Library does not rerun its bookmark query on background writes');
  assert.deepEqual(shown(), ['first'], 'Blurring keeps the published rows instead of clearing the list');
  h.focused = true; await act(async () => h.render());
  assert.equal(live().length, 1, 'Refocus resubscribes once');
  assert.deepEqual(shown(), ['first']);
  await act(async () => live()[0].rows([{id: 'second'}, {id: 'first'}]));
  assert.deepEqual(shown(), ['second', 'first']);
  await h.background('background');
  assert.equal(live().length, 0, 'Backgrounding stops the bookmark query');
  await h.background('active');
  assert.equal(live().length, 1);
  assert.equal(h.bookmarkWatches.length, 3);
}));

test('add-link keeps clipboard import and title-edit behavior separate from PDF handoff', async () => mounted(async root => {
  const h = await harness(root), submitted = []; let visible = true, imports = 0, title;
  h.clipboard = 'Read https://clipboard.test/article';
  const render = () => root.render(React.createElement(h.LinkInputDialog, {visible, initialTitle: title, onImportPdf: () => imports++, onDismiss() {visible = false; render();}, onSubmit: value => submitted.push(value)}));
  await act(async () => render()); await act(async () => h.timers.advance(350));
  assert.equal(h.v.one('TextInput').value, 'https://clipboard.test/article'); assert.equal(h.clipboardCalls, 1);
  await act(async () => h.button('add_link_btn_submit').onPress()); assert.deepEqual(submitted, ['https://clipboard.test/article']);
  await act(async () => h.v.one('SourceDialog').onDidDismiss()); assert.equal(imports, 0);
  title = 'Original title'; visible = true; await act(async () => render()); await act(async () => h.timers.advance(100));
  assert.equal(h.v.all('TextAction').length, 0); assert.equal(h.clipboardCalls, 1);
  await act(async () => h.v.one('TextInput').onChangeText(' \t ')); await act(async () => h.button('btn_confirm').onPress()); assert.equal(visible, true);
  await act(async () => h.v.one('TextInput').onChangeText('  New title  ')); await act(async () => h.v.one('TextInput').onSubmitEditing());
  assert.deepEqual(submitted, ['https://clipboard.test/article', 'New title']); assert.equal(imports, 0);
}));

test('a canceled upload settling after retry starts must not clear the new request busy state', async () => mounted(async root => {
  const h = await harness(root), first = deferred(), retry = deferred(); let calls = 0;
  h.upload = () => (++calls === 1 ? first.promise : retry.promise);
  await act(async () => h.render()); await h.choose(); await h.submit();
  await h.background('inactive'); await h.background('active'); await h.submit();
  assert.equal(h.uploads.length, 2); assert.equal(h.button('pdf_uploading').busy, true);
  await act(async () => first.reject(new Error('The native upload finished aborting')));
  assert.equal(h.v.all('SourceButton').some(props => props.label === 'pdf_uploading' && props.busy), true, 'The old upload finally block must not enable a duplicate submission during its replacement');
  assert.equal(h.action('pdf_pick').disabled, true); assert.equal(h.watches.length, 0);
  await act(async () => retry.resolve({bookmark_uid: 'current-upload'}));
  assert.deepEqual(Array.from(h.watches[0].params), ['current-upload']);
}));

test('PDF Labs fences a late mutation result with an aborted signal after an account change', async () => mounted(async root => {
  const h = await harness(root), mutation = deferred(); await h.loadHook();
  h.setLab = () => mutation.promise;
  await act(async () => {void h.labState.load(false);}); const oldSignal = h.changes[0][2];
  h.owner = 'account-b'; h.labs = async signal => {
    signal.throwIfAborted();
    return {features: [{key: 'pdf', enabled: false}]};
  };
  await act(async () => h.render()); assert.equal(oldSignal.aborted, true);
  assert.equal(h.labState.enabled, false); assert.equal(h.labState.failed, false);
  await act(async () => mutation.resolve());
  assert.equal(h.labState.enabled, false); assert.equal(h.labState.failed, false); assert.equal(h.labState.busy, false);
}));

for (const platform of ['ios', 'android']) for (const outcome of ['selected', 'canceled', 'failed']) test(`${platform} pending picker ${outcome} in background cannot show a modal until foreground`, async () => mounted(async root => {
  const h = await harness(root, platform), picker = deferred(); h.pick = () => picker.promise;
  await act(async () => h.render()); await h.choose(); assert.equal(h.pickCalls, 1);
  await h.background('inactive'); await h.background('background');
  await act(async () => outcome === 'failed' ? picker.reject(new Error('Native copy failed')) : picker.resolve(outcome === 'selected' ? h.selected : null));
  assert.equal(h.dialog().visible, false); assert.equal(h.v.all('SourceButton').length, 0);
  assert.equal(h.dismissals, 0); assert.deepEqual(h.saved, []); assert.deepEqual(h.uploads, []); assert.deepEqual(h.removed, []);
  await h.background('active');
  assert.equal(h.dialog().visible, true); assert.equal(h.pickCalls, 1);
  assert.equal(h.button('pdf_upload').disabled, outcome !== 'selected'); assert.equal(h.hasText('pdf_pick_failed'), outcome === 'failed');
  assert.equal(h.hasText(h.selected.name), outcome === 'selected');
  await act(async () => h.action('btn_close').onPress());
  assert.deepEqual(h.removed, outcome === 'selected' ? [h.selected.uri] : []);
}));

for (const platform of ['ios', 'android']) for (const completesAfterFocus of [false, true]) test(`${platform} Library focus exit fences pending native copy completed ${completesAfterFocus ? 'after' : 'before'} refocus`, async () => mounted(async root => {
  const h = await harness(root, platform), picker = deferred(); h.pick = () => picker.promise;
  await h.loadLibrary(); await h.openLibraryImport(); await h.choose();
  h.focused = false; await act(async () => h.render()); assert.equal(h.dialog().visible, false);
  if (completesAfterFocus) {h.focused = true; await act(async () => h.render());}
  await act(async () => picker.resolve(h.selected));
  assert.equal(h.dialog().visible, false); assert.deepEqual(h.removed, [h.selected.uri]); assert.deepEqual(h.navigations, []); assert.deepEqual(h.uploads, []);
  if (!completesAfterFocus) {h.focused = true; await act(async () => h.render());}
  assert.equal(h.dialog().visible, false); assert.equal(h.pickCalls, 1);
  await h.openLibraryImport(); assert.equal(h.button('pdf_upload').disabled, true); assert.equal(h.hasText(h.selected.name), false);
}));

for (const platform of ['ios', 'android']) for (const outcome of ['selected', 'failed']) test(`${platform} closing and reopening the same owner fences an old picker ${outcome} without ending a new picker`, async () => mounted(async root => {
  const h = await harness(root, platform), oldPicker = deferred(), newPicker = deferred();
  const oldFile = {...h.selected}, newFile = {uri: 'file:///cache/new-generation.pdf', name: 'New generation.pdf', size: 2048};
  h.pick = () => oldPicker.promise;
  await act(async () => h.render()); await h.choose();
  h.visible = false; await act(async () => h.render()); h.visible = true; await act(async () => h.render());
  assert.equal(h.button('pdf_upload').disabled, true);
  h.pick = () => newPicker.promise; await h.choose();
  await act(async () => outcome === 'failed' ? oldPicker.reject(new Error('Obsolete native copy failed')) : oldPicker.resolve(oldFile));
  assert.equal(h.dialog().visible, false, 'An obsolete picker finally must not finish the current picker');
  assert.deepEqual(h.removed, outcome === 'selected' ? [oldFile.uri] : []); assert.equal(h.pickCalls, 2);
  await act(async () => newPicker.resolve(newFile));
  assert.equal(h.dialog().visible, true); assert.equal(h.hasText(newFile.name), true); assert.equal(h.hasText(oldFile.name), false); assert.equal(h.hasText('pdf_pick_failed'), false);
  assert.equal(h.button('pdf_upload').disabled, false);
  await act(async () => h.action('btn_close').onPress());
  assert.deepEqual(h.removed, [...(outcome === 'selected' ? [oldFile.uri] : []), newFile.uri]);
}));

for (const platform of ['ios', 'android']) test(`${platform} old copy completed after a new selection cannot replace or release the new file`, async () => mounted(async root => {
  const h = await harness(root, platform), oldPicker = deferred(), oldFile = {...h.selected}; h.pick = () => oldPicker.promise;
  await act(async () => h.render()); await h.choose();
  h.visible = false; await act(async () => h.render()); h.visible = true; await act(async () => h.render());
  h.selected = {uri: 'file:///cache/current.pdf', name: 'Current.pdf', size: 4096}; h.pick = async () => h.selected; await h.choose();
  await act(async () => oldPicker.resolve(oldFile));
  assert.equal(h.hasText('Current.pdf'), true); assert.equal(h.hasText(oldFile.name), false); assert.deepEqual(h.removed, [oldFile.uri]);
  await h.submit(); assert.equal(h.uploads[0][0].uri, h.selected.uri); assert.equal(h.uploads[0][1], 'Current.pdf');
  assert.deepEqual(h.removed, [oldFile.uri, h.selected.uri]);
}));

for (const platform of ['ios', 'android']) for (const [development, capability, permitted] of [[true, undefined, false], [false, 'seeded-synthetic-only', false], [true, 'seeded-synthetic-only', true]]) test(`${platform} fixture picker opt-in dev=${development} capability=${capability}`, async () => mounted(async root => {
  const h = await harness(root, platform, development);
  h.fixtureOnly = {nativePdfImport: capability};
  await act(async () => h.render()); await h.choose();
  assert.equal(h.pickCalls, permitted ? 1 : 0); assert.equal(h.hasText('pdf_pick_failed'), !permitted);
  if (permitted) {await h.submit(); assert.equal(h.uploads[0][0] instanceof h.File, true); assert.equal(h.uploads[0][0].uri, h.selected.uri);}
  else {assert.equal(h.uploads.length, 0); assert.equal(h.button('pdf_upload').disabled, true);}
}));
