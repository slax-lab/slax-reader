import {Directory, File, Paths} from 'expo-file-system';
import {Platform} from 'react-native';
import {requireNativeModule} from 'expo-modules-core';
import {PdfFileStorage} from '../src/data/pdf-file-storage';
import {Sha256} from '../src/data/pdf-sha256';
import {assertFixtureScope} from './isolation';

export function createFixtureProductionPdfStorage(scopeUri: string, accountGuard: () => void) {
  const marker = JSON.parse(new File(scopeUri, 'slax-fixture.json').textSync());
  const validate = () => {
    if (!__DEV__) throw new Error('Production storage diagnostics require a development fixture');
    const current = JSON.parse(new File(scopeUri, 'slax-fixture.json').textSync());
    assertFixtureScope(scopeUri, Paths.cache.uri, current);
    if (!['reader-pdf-native-storage', 'reader-pdf-http'].includes(marker.scenario) || current.scenario !== marker.scenario || current.inputSha256 !== marker.inputSha256 || !/^[a-f0-9]{64}$/.test(marker.inputSha256)) throw new Error('Unexpected production storage fixture');
    const raw = requireNativeModule<{manifest: string | object}>('ExponentConstants').manifest;
    const config = typeof raw === 'string' ? JSON.parse(raw) : raw as {slug?: string; scheme?: string; ios?: {bundleIdentifier?: string}; android?: {package?: string}};
    if (config.slug !== 'slax-reader-ui-fixture' || config.scheme !== 'slaxreader-ui-fixture' || config.ios?.bundleIdentifier !== 'app.slax.reader.uifixture' || config.android?.package !== 'com.slax.reader.uifixture') throw new Error('Native application is not the isolated fixture');
  };
  validate();
  const cache = Paths.cache;
  let root: Directory;
  if (Platform.OS === 'android') {
    if (cache.name !== 'cache' || cache.parentDirectory.name !== 'com.slax.reader.uifixture') throw new Error('Unexpected Android fixture root');
    root = cache.parentDirectory;
  } else if (Platform.OS === 'ios') {
    if (cache.name !== 'Caches' || cache.parentDirectory.name !== 'Library') throw new Error('Unexpected iOS fixture root');
    root = new Directory(cache.parentDirectory, 'Application Support');
  } else throw new Error('Native PDF storage requires iOS or Android');
  const scopeKey = JSON.stringify(['slax-ui-native-pdf-storage', scopeUri, marker.inputSha256]);
  const hash = new Sha256().update(new TextEncoder().encode(JSON.stringify(scopeKey))).digest();
  const prefix = `pdf/v1/${hash}/`;
  const storage = new PdfFileStorage(root.uri, () => {validate(); accountGuard();});
  return {
    storage, scopeKey, prefix,
    cleanup() {validate(); new PdfFileStorage(root.uri, validate).clearScope(scopeKey);},
    async diagnose() {
      const path = `${prefix}diagnostic/probe.block`, first = new Uint8Array([37, 80, 68, 70]), replacement = new Uint8Array([5, 8, 13, 21, 34]);
      const same = (left: Uint8Array | null, right: Uint8Array) => left?.length === right.length && left.every((byte, index) => byte === right[index]);
      try {
        await storage.writeAtomic(path, first);
        if (!same(await storage.read(path), first) || await storage.size(path) !== first.length) throw new Error('Production PDF initial write/read failed');
        await storage.writeAtomic(path, replacement);
        if (!same(await storage.read(path), replacement) || await storage.size(path) !== replacement.length) throw new Error('Production PDF replacement failed');
        if (!(await storage.list(`${prefix}diagnostic/`)).includes(path)) throw new Error('Production PDF listing failed');
        await storage.remove(path);
        if (await storage.read(path) !== null || await storage.size(path) !== null || (await storage.list(`${prefix}diagnostic/`)).includes(path)) throw new Error('Production PDF removal failed');
        return {adapter: 'PdfFileStorage', nativePathGuard: 'SlaxCachePaths.pdfCacheFileUri', rootKind: Platform.OS === 'ios' ? 'ApplicationSupport' : 'context.dataDir', namespace: hash, writeRead: true, replacement: true, size: true, list: true, remove: true, nativeInteractionVerified: false};
      } finally {await storage.remove(path);}
    },
  };
}
