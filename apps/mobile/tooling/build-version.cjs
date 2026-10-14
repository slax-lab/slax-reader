const {readFileSync} = require('node:fs');
const path = require('node:path');

function parseBuildVersion(manifest) {
  if (!/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(manifest.version ?? '')) {
    throw new Error('apps/mobile/package.json version must be a three-part marketing version');
  }
  if (!Number.isSafeInteger(manifest.buildNumber) || manifest.buildNumber < 1 || manifest.buildNumber > 2100000000) {
    throw new Error('apps/mobile/package.json buildNumber must be an integer between 1 and 2100000000');
  }
  if (!Number.isSafeInteger(manifest.previousBuildNumber) || manifest.previousBuildNumber < 0 || manifest.previousBuildNumber >= manifest.buildNumber) {
    throw new Error('apps/mobile/package.json buildNumber must exceed previousBuildNumber');
  }
  return {version: manifest.version, build: String(manifest.buildNumber), previous: String(manifest.previousBuildNumber), displayVersion: `${manifest.version}(${manifest.buildNumber})`};
}

function readBuildVersion() {
  return parseBuildVersion(JSON.parse(readFileSync(path.join(__dirname, '../package.json'), 'utf8')));
}

module.exports = {parseBuildVersion, readBuildVersion};
