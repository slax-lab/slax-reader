const { getDefaultConfig } = require('expo/metro-config');
const {configureDevelopmentMetro} = require('./tooling/development-metro.cjs');

module.exports = process.env.SLAX_RESET_UI_ACCEPTANCE === '1'
  ? require('./tests/data/legacy-reset-ui/metro.cjs')
  : configureDevelopmentMetro(getDefaultConfig(__dirname), __dirname);
