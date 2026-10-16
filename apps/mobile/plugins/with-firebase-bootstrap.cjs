const {withPlugins} = require('expo/config-plugins');

/** Apply the approved SDK bootstrap only for operator-configured platforms. */
module.exports = function withFirebaseBootstrap(config) {
  const enabled = {ios: Boolean(config.ios?.googleServicesFile), android: Boolean(config.android?.googleServicesFile)};
  if (!enabled.ios && !enabled.android) return config;
  const previous = {ios: {...config.mods?.ios}, android: {...config.mods?.android}};
  config = withPlugins(config, ['@react-native-firebase/app', '@react-native-firebase/crashlytics']);
  for (const platform of ['ios', 'android']) {
    if (!enabled[platform]) {
      if (Object.keys(previous[platform]).length) config.mods[platform] = previous[platform];
      else delete config.mods[platform];
    }
  }
  return config;
};
