import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const stub = source => ({url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true});
// Only native platform hooks are replaced. The real RN SDK/queue/storage classes remain intact.
export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'react-native') return stub('export const NativeModules={}; export const Platform={OS:"ios",Version:"fixture",constants:{reactNativeVersion:{major:0,minor:86}}};');
  if (specifier === '@op-engineering/op-sqlite') return stub('export function open(){throw new Error("Native OP-SQLite is not available in this host fixture")}; export function getDylibPath(){throw new Error("Native OP-SQLite is not available in this host fixture")};');
  try { return await nextResolve(specifier, context); }
  catch(error) {
    if (specifier.startsWith('.') && context.parentURL?.includes('/@powersync/') && existsSync(fileURLToPath(new URL(specifier + '.js', context.parentURL)))) return nextResolve(specifier + '.js', context);
    throw error;
  }
}
