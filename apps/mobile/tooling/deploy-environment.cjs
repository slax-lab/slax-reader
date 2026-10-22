const {existsSync, lstatSync, readFileSync} = require('node:fs');
const path = require('node:path');
const {parseEnv} = require('node:util');

const DEFAULT_FILES = {
  SLAX_MOBILE_FIREBASE_IOS_CONFIG: 'ios/GoogleService-Info.plist',
  SLAX_MOBILE_FIREBASE_ANDROID_CONFIG: 'android/google-services.json',
  SLAX_ANDROID_KEYSTORE_PATH: 'android/slax-reader.release.jks',
};

function parseConfiguration(content, filename) {
  const invalid = () => {throw new Error(`Invalid mobile environment file: ${filename}`);};
  if (content.includes('\0')) invalid();
  const lines = content.replace(/^\uFEFF/, '').split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trim();
    if (!line || line.startsWith('#')) continue;
    const assignment = line.match(/^(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*\s*=\s*(.*)$/);
    if (!assignment) invalid();
    let value = assignment[1];
    const quote = value[0];
    if (!['"', "'", '`'].includes(quote)) continue;
    value = value.slice(1);
    while (!value.includes(quote)) {
      if (++index >= lines.length) invalid();
      value += '\n' + lines[index];
    }
    const suffix = value.slice(value.indexOf(quote) + 1).trim();
    if (suffix && !suffix.startsWith('#')) invalid();
  }
  return parseEnv(content);
}

/** @param {{root?: string, processEnvironment?: NodeJS.ProcessEnv, readLocal?: boolean, development?: boolean}} [options] */
function loadMobileEnvironment({root = path.resolve(__dirname, '../../..'), processEnvironment = process.env, readLocal = true, development = false} = {}) {
  const directory = path.resolve(root, 'deploy/mobile');
  const inherited = Object.fromEntries(Object.entries(processEnvironment).filter(([, value]) => value !== undefined));
  if (!development) for (const key of Object.keys(inherited)) if (key.startsWith('SLAX_MOBILE_DEV_')) delete inherited[key];
  const fixture = inherited.EXPO_PUBLIC_SLAX_ADOPTION_FIXTURE === '1' || Boolean(inherited.EXPO_PUBLIC_SLAX_UI_FIXTURE);
  if (!readLocal || fixture || inherited.SLAX_MOBILE_NO_LOCAL_CONFIG === '1') return {directory, environment: inherited, files: []};

  const filename = path.join(directory, '.env');
  let local = {}, files = [];
  if (existsSync(filename)) {
    if (!lstatSync(filename).isFile()) throw new Error('Mobile configuration must be a regular file: deploy/mobile/.env');
    let content;
    try {content = readFileSync(filename, 'utf8');}
    catch {throw new Error('Cannot read mobile configuration: deploy/mobile/.env');}
    local = parseConfiguration(content, filename);
    files.push('deploy/mobile/.env');
  }
  const environment = {...local, ...inherited};
  if (!development) for (const key of Object.keys(environment)) if (key.startsWith('SLAX_MOBILE_DEV_')) delete environment[key];
  for (const [name, relative] of Object.entries(DEFAULT_FILES)) {
    if (environment[name]) {
      environment[name] = path.resolve(root, environment[name]);
    } else {
      const candidate = path.join(directory, relative);
      if (!existsSync(candidate)) continue;
      if (!lstatSync(candidate).isFile()) throw new Error(`Mobile build input must be a regular file: deploy/mobile/${relative}`);
      environment[name] = candidate;
    }
  }
  return {directory, environment, files};
}

function applyMobileEnvironment() {
  const result = loadMobileEnvironment();
  for (const [name, value] of Object.entries(result.environment)) process.env[name] = value;
  return result;
}

module.exports = {loadMobileEnvironment, applyMobileEnvironment};
