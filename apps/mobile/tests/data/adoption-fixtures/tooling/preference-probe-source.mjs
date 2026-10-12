import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

const region = (source, start, end) => {
  const first = source.indexOf(start), last = source.indexOf(end, first + start.length);
  assert(first >= 0 && last > first && source.indexOf(start, first + start.length) === -1, 'The exact native preference source boundaries changed');
  return source.slice(first, last);
};
export function extractPreferenceBodies(source, platform) {
  assert(['android', 'ios'].includes(platform));
  const android = platform === 'android';
  const lockingAndSnapshot = region(source, android ? '  private fun <T> withPreferenceLock' : '  private func withPreferencesLock', android ? '  private fun jsonMap' : '  private func releaseOwner');
  const jsonMap = android ? region(source, '  private fun jsonMap', '  private fun releaseOwner') : '';
  const declaration = android ? '    AsyncFunction("compareAndSwapPreferences") { revision: Long, values: Map<String, Any?> ->' : '    AsyncFunction("compareAndSwapPreferences") { (revision: Int, values: [String: Any]) -> Bool in';
  const closure = region(source, declaration, '    AsyncFunction("readLegacyPreferences")');
  const body = closure.slice(declaration.length).trimEnd();
  assert(body.endsWith('}'), 'The native CAS closure boundary changed');
  const compareAndSwap = body.slice(0, -1);
  assert(lockingAndSnapshot.includes(android ? 'file.channel.lock()' : 'flock(descriptor, LOCK_EX | LOCK_NB)') && compareAndSwap.includes(android ? 'StandardCopyOption.ATOMIC_MOVE' : '.atomic'), 'The native lock/atomic-write implementation is missing');
  const hashes = Object.fromEntries(Object.entries({lockingAndSnapshot, jsonMap, compareAndSwap}).map(([key, value]) => [key, createHash('sha256').update(value).digest('hex')]));
  return {lockingAndSnapshot, jsonMap, compareAndSwap, hashes};
}
