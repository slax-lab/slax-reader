const test = require('node:test');
const assert = require('node:assert/strict');
const withPasskeys = require('../../plugins/with-passkeys.cjs');

test('Passkey Android association plugin derives HTTPS host and preserves existing manifest entries', async () => {
  const config = withPasskeys({}, {webUrl: 'https://reader.example/path'});
  const application = {$: {'android:name': '.MainApplication'}, 'meta-data': [{$: {'android:name': 'unrelated', 'android:value': 'kept'}}]};
  let manifest = {modResults: {manifest: {application: [application]}}};
  manifest = await config.mods.android.manifest(manifest);
  manifest = await config.mods.android.manifest(manifest);
  assert.deepEqual(application['meta-data'], [{$: {'android:name': 'unrelated', 'android:value': 'kept'}}, {$: {'android:name': 'asset_statements', 'android:resource': '@string/asset_statements'}}]);
  const strings = await config.mods.android.strings({modResults: {resources: {string: [{$: {name: 'unrelated'}, _: 'kept'}]}}});
  const values = strings.modResults.resources.string;
  assert.ok(values.some(item => item.$.name === 'unrelated' && item._ === 'kept'));
  assert.equal(values.find(item => item.$.name === 'asset_statements')._, '[{\\"include\\":\\"https://reader.example/.well-known/assetlinks.json\\"}]');
});

for (const url of ['http://reader.example', 'https://user:password@reader.example']) test(`Passkey association rejects invalid public Web URL ${new URL(url).protocol}`, () => {
  assert.throws(() => withPasskeys({}, {webUrl: url}), /HTTPS Web URL/);
});
