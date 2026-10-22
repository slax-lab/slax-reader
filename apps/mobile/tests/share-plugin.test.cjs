const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {writeIosFiles} = require('../plugins/with-share.cjs')._test;

test('generated Share plist keeps New Architecture enabled and uses the approved version/build', () => {
  const platformRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'slax-share-plist-test-'));
  try {
    writeIosFiles(platformRoot, path.resolve(__dirname, '..'), {
      versionName: '1.0.25', versionCode: '782',
      apiBaseUrl: 'https://api.example.test', apiBetaUrl: 'https://api-beta.example.test',
    });
    const info = fs.readFileSync(path.join(platformRoot, 'SlaxShare', 'Info.plist'), 'utf8');
    assert.match(info, /<key>CFBundleIdentifier<\/key><string>\$\(PRODUCT_BUNDLE_IDENTIFIER\)<\/string>/);
    assert.match(info, /<key>CFBundleShortVersionString<\/key><string>1\.0\.25<\/string>/);
    assert.match(info, /<key>CFBundleVersion<\/key><string>782<\/string>/);
    assert.match(info, /<key>RCTNewArchEnabled<\/key><true\/>/);
    const entitlements = fs.readFileSync(path.join(platformRoot, 'SlaxShare', 'SlaxShare.entitlements'), 'utf8');
    assert.match(entitlements, /<string>group\.app\.slax\.reader<\/string>/);
  } finally {
    fs.rmSync(platformRoot, {recursive: true, force: true});
  }
});
