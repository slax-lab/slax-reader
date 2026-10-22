const { getDefaultConfig } = require('expo/metro-config');
const {configureDevelopmentMetro} = require('./tooling/development-metro.cjs');

module.exports = configureDevelopmentMetro(getDefaultConfig(__dirname), __dirname);
