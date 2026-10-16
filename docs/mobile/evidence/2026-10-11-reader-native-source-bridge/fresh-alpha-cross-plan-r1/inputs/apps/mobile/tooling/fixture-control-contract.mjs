/** Refuse ambiguous or external inspectors before any expression reaches a runtime. */
export function selectFixtureInspector(targets, platform, device) {
  if (!['android', 'ios'].includes(platform) || typeof device !== 'string' || !device) throw new Error('Explicit isolated platform/device required');
  const appId = platform === 'ios' ? 'app.slax.reader.uifixture' : 'com.slax.reader.uifixture';
  if (!Array.isArray(targets)) throw new Error('Invalid inspector inventory');
  const matches = targets.filter(target => target?.appId === appId && target.deviceName === device);
  if (matches.length !== 1) throw new Error('Exactly one matching independent UI fixture target must be attached');
  const endpoint = new URL(matches[0].webSocketDebuggerUrl);
  if (endpoint.protocol !== 'ws:' || endpoint.hostname !== '127.0.0.1' || endpoint.port !== '8083' || endpoint.pathname !== '/inspector/debug' || endpoint.username || endpoint.password || endpoint.hash) throw new Error('Unexpected local fixture inspector endpoint');
  return {appId, endpoint: endpoint.href};
}
