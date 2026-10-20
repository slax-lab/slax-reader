const {withPlugins, withDangerousMod, IOSConfig} = require('expo/config-plugins');
const {readFile, writeFile} = require('node:fs/promises');
const {configureFirebaseAppDelegate} = require('./firebase-app-delegate.cjs');

/** Apply the approved SDK bootstrap only for operator-configured platforms. */
module.exports = function withFirebaseBootstrap(config) {
  const enabled = {ios: Boolean(config.ios?.googleServicesFile), android: Boolean(config.android?.googleServicesFile)};
  if (!enabled.ios && !enabled.android) return config;
  const previous = {ios: {...config.mods?.ios}, android: {...config.mods?.android}};
  config = withPlugins(config, ['@react-native-firebase/app', '@react-native-firebase/crashlytics']);
  if (enabled.ios) {
    // Dangerous mods run before AppDelegate mods. Register last so upstream sees
    // the owned initialization and does not attempt its obsolete factory anchor.
    config = withDangerousMod(config, ['ios', async mod => {
      const file = IOSConfig.Paths.getAppDelegate(mod.modRequest.projectRoot);
      const contents = await readFile(file.path, 'utf8');
      await writeFile(file.path, configureFirebaseAppDelegate({...file, contents}));
      return mod;
    }]);
  }
  for (const platform of ['ios', 'android']) {
    if (!enabled[platform]) {
      if (Object.keys(previous[platform]).length) config.mods[platform] = previous[platform];
      else delete config.mods[platform];
    }
  }
  return config;
};
