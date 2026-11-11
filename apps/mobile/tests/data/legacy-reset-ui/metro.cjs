const path = require('node:path');
const {getDefaultConfig} = require('expo/metro-config');
const root = path.resolve(__dirname, '../../..');
if (process.env.EXPO_PUBLIC_SLAX_ADOPTION_FIXTURE !== '1' || process.env.EXPO_PUBLIC_SLAX_API_URL !== 'http://127.0.0.1:8198') throw new Error('Isolated reset UI configuration required');
const config = getDefaultConfig(root);
config.projectRoot = root;
config.resolver.resolveRequest = (context, name, platform) => {
  const resolved = context.resolveRequest(context, name, platform);
  if (resolved.type !== 'sourceFile') return resolved;
  if (resolved.filePath === path.join(root, 'index.ts')) return {type: 'sourceFile', filePath: path.join(__dirname, 'entry.ts')};
  if (resolved.filePath === path.join(root, 'src/auth/providers.ts')) return {type: 'sourceFile', filePath: path.join(__dirname, 'provider.ts')};
  return resolved;
};
module.exports = config;
