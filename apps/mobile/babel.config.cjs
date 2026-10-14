const {createRequire} = require('node:module');
const expoRequire = createRequire(require.resolve('expo/package.json'));
module.exports = function (api) {
  api.cache(true);
  return { presets: [expoRequire.resolve('babel-preset-expo')] };
};
