const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const {loadMobileEnvironment} = require('./deploy-environment.cjs');

function endpoint(value, name) {
  let url;
  try {url = new URL(value);} catch {throw new Error(`${name} must be an HTTP(S) URL`);}
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error(`${name} must be an HTTP(S) URL without credentials, query or fragment`);
  return url;
}
function developmentSession(environment) {
  const keys = ['SLAX_MOBILE_DEV_API_URL', 'SLAX_MOBILE_DEV_POWERSYNC_URL', 'SLAX_MOBILE_DEV_TOKEN'];
  if (!keys.some(key => environment[key])) return null;
  for (const key of keys) if (!environment[key]) throw new Error(`Set ${key} in deploy/mobile/.env to configure the development session`);
  const api = endpoint(environment[keys[0]], keys[0]);
  const sync = endpoint(environment[keys[1]], keys[1]);
  if (['api-reader.slax.com', 'api-reader-beta.slax.com'].includes(api.hostname)) throw new Error('Use a development API origin with SLAX_MOBILE_DEV_TOKEN');
  const token = environment[keys[2]];
  let payload;
  try {
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error();
    payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {throw new Error('SLAX_MOBILE_DEV_TOKEN must be a reader session JWT');}
  if (!['string', 'number'].includes(typeof payload.id) || !String(payload.id)) throw new Error('SLAX_MOBILE_DEV_TOKEN must contain a user id');
  const web = endpoint(environment.SLAX_MOBILE_DEV_WEB_URL || `http://${api.hostname}:3000`, 'SLAX_MOBILE_DEV_WEB_URL');
  return {apiUrl: api.origin, powerSyncUrl: sync.href.replace(/\/$/, ''), webUrl: web.origin, webDomain: web.hostname, token, userId: String(payload.id)};
}
function localRelays(session) {
  const addresses = new Set(Object.values(os.networkInterfaces()).flat().filter(Boolean).map(address => address.address));
  const servers = [], sockets = new Set(), seen = new Set();
  for (const value of [session.apiUrl, session.powerSyncUrl, session.webUrl]) {
    const url = new URL(value), host = url.hostname.replace(/^\[|\]$/g, '');
    if (url.protocol !== 'http:' || !addresses.has(host) || host === '127.0.0.1' || host === '::1') continue;
    const port = Number(url.port || 80), key = `${host}:${port}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const server = http.createServer((request, response) => {
      const upstream = http.request({host: 'localhost', port, path: request.url, method: request.method, headers: {...request.headers, host: `localhost:${port}`}, autoSelectFamily: true}, result => {
        response.writeHead(result.statusCode ?? 502, result.headers);
        result.pipe(response);
      });
      upstream.on('error', () => {if (!response.headersSent) response.writeHead(502); response.end();});
      response.on('close', () => upstream.destroy());
      request.pipe(upstream);
    });
    server.on('upgrade', (request, client, head) => {
      const upstream = net.createConnection({host: 'localhost', port, autoSelectFamily: true}, () => {
        const headers = Object.entries(request.headers).filter(([name]) => name.toLowerCase() !== 'host').map(([name, value]) => `${name}: ${Array.isArray(value) ? value.join(', ') : value}`);
        upstream.write(`${request.method} ${request.url} HTTP/1.1\r\nHost: localhost:${port}\r\n${headers.join('\r\n')}\r\n\r\n`);
        if (head.length) upstream.write(head);
        client.pipe(upstream); upstream.pipe(client);
      });
      sockets.add(client); sockets.add(upstream);
      client.on('error', () => upstream.destroy()); upstream.on('error', () => client.destroy());
      client.on('close', () => {sockets.delete(client); upstream.destroy();});
      upstream.on('close', () => {sockets.delete(upstream); client.destroy();});
    });
    server.on('error', error => {if (error.code !== 'EADDRINUSE') console.error(`Mobile development relay ${port}: ${error.code}`);});
    server.listen(port, host);
    servers.push(server);
  }
  const close = () => {for (const socket of sockets) socket.destroy(); for (const server of servers) server.close();};
  process.once('SIGINT', close); process.once('SIGTERM', close); process.once('exit', close);
}
function developmentCommand(commandLine) {
  if (commandLine.some((value, index) => value === '--release' || ['--configuration', '--variant'].includes(value) && String(commandLine[index + 1]).toLowerCase() === 'release')) return false;
  return commandLine.some(value => ['start', 'run:ios', 'run:android'].includes(value));
}
function configureDevelopmentMetro(config, appRoot, {root = path.resolve(appRoot, '../..'), processEnvironment = process.env, commandLine = process.argv, relay = localRelays} = {}) {
  if (!developmentCommand(commandLine)) return config;
  const {environment} = loadMobileEnvironment({root, processEnvironment, development: true});
  const session = developmentSession(environment);
  if (!session) return config;
  const generated = path.join(root, '.local/mobile-development');
  fs.mkdirSync(generated, {recursive: true, mode: 0o700});
  const sessionFile = path.join(generated, 'session.cjs');
  if (fs.existsSync(sessionFile) && fs.lstatSync(sessionFile).isSymbolicLink()) throw new Error('Development session cache cannot be a symbolic link');
  fs.writeFileSync(sessionFile, `module.exports = {developmentSession: ${JSON.stringify(session)}};\n`, {mode: 0o600});
  fs.chmodSync(sessionFile, 0o600);
  const source = path.join(appRoot, 'src'), development = path.join(source, 'development');
  const fallback = config.resolver.resolveRequest;
  config.watchFolders = [...new Set([...(config.watchFolders || []), generated])];
  config.resolver.resolveRequest = (context, name, platform) => {
    if (context.originModulePath === path.join(source, 'runtime.tsx') && name === './data') return {type: 'sourceFile', filePath: path.join(development, 'runtime.ts')};
    const resolved = fallback ? fallback(context, name, platform) : context.resolveRequest(context, name, platform);
    if (resolved.type !== 'sourceFile') return resolved;
    if (resolved.filePath === path.join(development, 'session.ts')) return {type: 'sourceFile', filePath: sessionFile};
    if (resolved.filePath === path.join(source, 'config.ts') && context.originModulePath !== path.join(development, 'config.ts')) return {type: 'sourceFile', filePath: path.join(development, 'config.ts')};
    return resolved;
  };
  relay(session);
  console.log('Mobile development configuration loaded from deploy/mobile/.env');
  return config;
}
module.exports = {configureDevelopmentMetro, developmentCommand, developmentSession};
