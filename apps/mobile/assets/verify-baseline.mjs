import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const assetsRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(assetsRoot, '../../..');
const require = createRequire(import.meta.url);
const ts = require('typescript');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const json = async (relative) => JSON.parse(await readFile(path.join(repoRoot, relative), 'utf8'));
const sourceFlag = process.argv.indexOf('--source');
const sourceRoot = sourceFlag < 0 ? null : await realpath(process.argv[sourceFlag + 1]);
assert(sourceFlag < 0 || process.argv.length === sourceFlag + 2, 'Expected --source <checkout>');

// This independent whitelist is checked before opening optional source files.
function allowedSource(relative) {
  if (path.isAbsolute(relative) || relative.split('/').includes('..')) return false;
  const name = path.posix.basename(relative).toLowerCase();
  if (name.startsWith('.env') || name.startsWith('.dev.vars') ||
      /googleservice|google-services|credentials|keystore|\.p12|\.p8|\.pem/.test(name)) return false;
  return [
    /^composeApp\/src\/(commonMain|androidMain|iosMain|commonTest|androidInstrumentedTest)\/kotlin\/.+\.kt$/,
    /^composeApp\/src\/commonMain\/composeResources\/drawable\/[^/]+\.(png|xml)$/,
    /^composeApp\/src\/commonMain\/composeResources\/files\/share_logo\.png$/,
    /^composeApp\/src\/androidMain\/ic_launcher-playstore\.png$/,
    /^composeApp\/src\/androidMain\/res\/mipmap[^/]*\/ic_launcher[^/]*\.(webp|xml)$/,
    /^composeApp\/src\/androidMain\/res\/values\/(ic_launcher_background|styles|strings)\.xml$/,
    /^iosApp\/(iosApp|share)\/[^/]+\.swift$/,
    /^iosApp\/share\/ExtensionClass\.js$/,
    /^iosApp\/share\/Base\.lproj\/MainInterface\.storyboard$/,
    /^iosApp\/iosApp\/Assets\.xcassets\/AppIcon\.appiconset\/1024\.png$/,
    /^public\/embedded\/(css\/[^/]+\.css|html\/[^/]+\.html|js\/[^/]+\.js|image\/error\.png)$/,
    /^LICENSE$/,
  ].some((pattern) => pattern.test(relative));
}

const manifestBytes = await readFile(path.join(repoRoot, 'docs/mobile/source-manifest.json'));
const manifest = JSON.parse(manifestBytes);
assert.equal(manifest.inputPolicy.secretFilesReadOrHashed, false);
assert.equal(manifest.files.length, manifest.includedFileCount);
const sourcePaths = new Set();
for (const entry of manifest.files) {
  assert(allowedSource(entry.path), `Source input is outside the closed whitelist: ${entry.path}`);
  assert(!sourcePaths.has(entry.path), `Duplicate source entry: ${entry.path}`);
  sourcePaths.add(entry.path);
  assert.match(entry.sha256, /^[a-f0-9]{64}$/);
  if (sourceRoot) {
    const filename = await realpath(path.join(sourceRoot, entry.path));
    const relativeRealpath = path.relative(sourceRoot, filename);
    assert(!relativeRealpath.startsWith('..') && !path.isAbsolute(relativeRealpath), 'External source symlink');
    const bytes = await readFile(filename);
    assert.equal(bytes.length, entry.bytes, `Source length drift: ${entry.path}`);
    assert.equal(hash(bytes), entry.sha256, `Source content drift: ${entry.path}`);
  }
}
assert(manifest.files.some((entry) => entry.gitStatus === '??' && entry.path.includes('/ui/rss/')),
  'Untracked RSS baseline must be included');
assert(manifest.files.some((entry) => entry.gitStatus.trim() === 'M'), 'Dirty source overlay must be included');

const provenance = await json('apps/mobile/assets/provenance.json');
const registry = await readFile(path.join(assetsRoot, 'index.ts'), 'utf8');
const runtimeKeys = new Set([...registry.matchAll(/^  (\w+): require\('([^']+)'\),$/gm)]
  .map((match) => match[1]));
const expectedRuntimeKeys = new Set();
for (const asset of provenance.assets) {
  assert(sourcePaths.has(asset.sourcePath), `Unknown asset source: ${asset.sourcePath}`);
  const target = path.resolve(repoRoot, asset.targetPath);
  assert(target.startsWith(assetsRoot + path.sep), 'Target asset must be application-owned');
  const bytes = await readFile(target);
  assert.equal(hash(bytes), asset.targetSha256, `Asset content drift: ${asset.key}`);
  assert.equal(bytes.readUInt32BE(16), asset.pixelWidth);
  assert.equal(bytes.readUInt32BE(20), asset.pixelHeight);
  if (asset.transform === 'identity') assert.equal(asset.targetSha256, asset.sourceSha256);
  if (asset.runtimeUse === 'available') expectedRuntimeKeys.add(asset.key);
}
assert.deepEqual([...runtimeKeys].sort(), [...expectedRuntimeKeys].sort());
assert(!runtimeKeys.has('ic_sm_back'), 'Routed back must remain a native control');
for (const match of registry.matchAll(/^  (\w+): require\('([^']+)'\),$/gm)) {
  const filename = path.resolve(assetsRoot, match[2]);
  const record = provenance.assets.find((asset) => asset.key === match[1]);
  assert.equal(filename, path.resolve(repoRoot, record.targetPath));
}
for (const conversion of (await json('apps/mobile/assets/vector-conversions.json')).conversions) {
  assert.equal(hash(await readFile(path.join(assetsRoot, 'vectors', conversion.name + '.xml'))), conversion.sourceSha256);
  assert.equal(hash(await readFile(path.join(assetsRoot, 'vectors', conversion.name + '.svg'))), conversion.svgSha256);
  assert.equal(hash(await readFile(path.join(assetsRoot, 'drawable', conversion.name + '.png'))), conversion.pngSha256);
  assert.equal(conversion.scale, 4);
}

async function loadOwnTypeScript(relative, dependencies = {}) {
  const filename = path.join(repoRoot, relative);
  const source = await readFile(filename, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    reportDiagnostics: true,
  });
  assert.equal(compiled.diagnostics?.length ?? 0, 0, `TypeScript parse diagnostics: ${relative}`);
  const exports = {};
  vm.runInNewContext(compiled.outputText, {
    exports,
    require(name) {
      assert(Object.hasOwn(dependencies, name), `Unexpected import during isolated verification: ${name}`);
      return dependencies[name];
    },
  }, { filename });
  return exports;
}
const catalogueModule = await loadOwnTypeScript('apps/mobile/src/i18n/messages.ts');
const catalogue = catalogueModule.messages;
assert.deepEqual(Object.keys(catalogue).sort(), ['en', 'zh']);
assert.equal(Object.keys(catalogue.en).length, manifest.localization.activeKeyCount);
assert.deepEqual(Object.keys(catalogue.en).sort(), Object.keys(catalogue.zh).sort());
assert.deepEqual(Object.keys(catalogue.en).sort(), Object.keys(manifest.localization.keySourceLines).sort());
assert.equal(hash(await readFile(path.join(repoRoot, manifest.localization.targetPath))), manifest.localization.targetSha256);
const appCatalogueModule = await loadOwnTypeScript('apps/mobile/src/i18n/appMessages.ts');
assert.deepEqual(Object.keys(appCatalogueModule.appMessages.en).sort(), Object.keys(appCatalogueModule.appMessages.zh).sort());
assert(Object.keys(appCatalogueModule.appMessages.en).every(key => !Object.hasOwn(catalogue.en, key)), 'Migration keys must not overwrite source keys');
const i18n = await loadOwnTypeScript('apps/mobile/src/i18n/index.ts', { './messages': catalogueModule, './appMessages': appCatalogueModule });
assert.equal(i18n.translate('zh', 'upgrade_required_title'), appCatalogueModule.appMessages.zh.upgrade_required_title);
assert.equal(i18n.normalizeLocale('zh-Hans'), 'zh');
assert.equal(i18n.normalizeLocale('en-US'), 'en');
assert.equal(i18n.normalizeLocale('fr'), 'en');
assert.equal(i18n.translate('en', 'unknown_source_key'), 'unknown_source_key');
assert.equal(i18n.translate('en', 'toString'), 'toString');
assert.equal(i18n.translate('en', 'collection_closed_message', ['Example']), 'The Example collection has been closed');
assert.equal(i18n.translate('zh', 'feedback_allow_follow_up', { email: 'example@example.test' }),
  '允许通过 example@example.test 进行跟进');
assert.equal(i18n.translate('en', 'collection_closed_message', []), catalogue.en.collection_closed_message);
assert.equal(i18n.translate('en', 'feedback_allow_follow_up', {}), catalogue.en.feedback_allow_follow_up);
assert.equal(i18n.translate('en', 'feedback_allow_follow_up', { other: 'missing' }), 'Allow follow-up at ');
assert.equal(i18n.createTranslator('zh')('btn_back'), catalogue.zh.btn_back);
for (const locale of ['en', 'zh']) {
  for (const key of Object.keys(catalogue[locale])) {
    assert.equal(i18n.translate(locale, key), catalogue[locale][key]);
    const positional = catalogue[locale][key].match(/\{\d+\}/g) ?? [];
    const named = catalogue[locale][key].match(/\{[^}\d]+\}/g) ?? [];
    const other = locale === 'en' ? 'zh' : 'en';
    assert.deepEqual(positional.slice().sort(), (catalogue[other][key].match(/\{\d+\}/g) ?? []).sort(),
      `Positional placeholder mismatch: ${key}`);
    assert.deepEqual(named.slice().sort(), (catalogue[other][key].match(/\{[^}\d]+\}/g) ?? []).sort(),
      `Named placeholder mismatch: ${key}`);
  }
}
const { mobileColors, mobileLayout } = await loadOwnTypeScript('apps/mobile/src/theme/index.ts');
assert(Object.values(mobileColors).every((color) => /^#[A-F0-9]{6}([A-F0-9]{2})?$/.test(color)));
assert.equal(mobileLayout.loginArtworkAspectRatio, 375 / 314);
assert.equal(mobileLayout.iosSharePanelHeight, 180);
const { mobileTestIds } = await loadOwnTypeScript('apps/mobile/src/theme/testIds.ts');
assert.equal(new Set(Object.values(mobileTestIds)).size, Object.keys(mobileTestIds).length);

console.log(JSON.stringify({
  sourceFiles: manifest.files.length,
  sourceHashesVerified: sourceRoot !== null,
  runtimeAssets: runtimeKeys.size,
  localizedKeys: Object.keys(catalogue.en).length,
  migrationProtectionKeys: Object.keys(appCatalogueModule.appMessages.en).length,
  stableTestIds: Object.keys(mobileTestIds).length,
}, null, 2));
