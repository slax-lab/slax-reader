const {withAndroidManifest, withStringsXml, AndroidConfig} = require('expo/config-plugins');

module.exports = function withPasskeys(config, {webUrl}) {
  const url = new URL(webUrl);
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) throw new Error('Passkey association requires an HTTPS Web URL without credentials');
  config = withAndroidManifest(config, mod => {
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(mod.modResults);
    const metadata = application['meta-data'] ??= [];
    const entry = metadata.find(item => item.$['android:name'] === 'asset_statements');
    if (entry) entry.$['android:resource'] = '@string/asset_statements';
    else metadata.push({$: {'android:name': 'asset_statements', 'android:resource': '@string/asset_statements'}});
    return mod;
  });
  return withStringsXml(config, mod => {
    mod.modResults = AndroidConfig.Strings.setStringItem([{
      $: {name: 'asset_statements', translatable: 'false'},
      _: JSON.stringify([{include: `https://${url.hostname}/.well-known/assetlinks.json`}]).replace(/"/g, '\\"'),
    }], mod.modResults);
    return mod;
  });
};
