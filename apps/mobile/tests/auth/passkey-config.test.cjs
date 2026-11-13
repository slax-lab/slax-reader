const test = require('node:test');
const assert = require('node:assert/strict');
const withPasskeys = require('../../plugins/with-passkeys.cjs');

test('Passkey Android association plugin derives HTTPS host and preserves existing manifest entries', async () => {
  const config = withPasskeys({}, {webUrls: ['https://r.slax.dev', 'https://r-beta.slax.com', 'https://r.slax.com']});
  const application = {$: {'android:name': '.MainApplication'}, 'meta-data': [{$: {'android:name': 'unrelated', 'android:value': 'kept'}}]};
  let manifest = {modResults: {manifest: {application: [application]}}};
  manifest = await config.mods.android.manifest(manifest);
  manifest = await config.mods.android.manifest(manifest);
  assert.deepEqual(application['meta-data'], [{$: {'android:name': 'unrelated', 'android:value': 'kept'}}, {$: {'android:name': 'asset_statements', 'android:resource': '@string/asset_statements'}}]);
  const strings = await config.mods.android.strings({modResults: {resources: {string: [{$: {name: 'unrelated'}, _: 'kept'}]}}});
  const values = strings.modResults.resources.string;
  assert.ok(values.some(item => item.$.name === 'unrelated' && item._ === 'kept'));
  const statements = JSON.parse(values.find(item => item.$.name === 'asset_statements')._.replaceAll('\\', ''));
  assert.deepEqual(statements, ['r.slax.dev', 'r-beta.slax.com', 'r.slax.com'].map(host => ({include: `https://${host}/.well-known/assetlinks.json`})));
});

for (const url of ['http://reader.example', 'https://user:password@reader.example']) test(`Passkey association rejects invalid public Web URL ${new URL(url).protocol}`, () => {
  assert.throws(() => withPasskeys({}, {webUrls: [url]}), /HTTPS Web URL/);
});
