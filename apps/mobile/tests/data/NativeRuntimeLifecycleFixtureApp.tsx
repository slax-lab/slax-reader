import React, {useEffect, useState} from 'react';
import {AppState, Platform, ScrollView, Text} from 'react-native';
import {File, Paths} from 'expo-file-system';
import {createMobileDataRuntime} from '../../src/data/runtime.ts';
import {loadLegacyBridge} from '../../src/data/native-storage.ts';

function check(value: unknown, message: string): asserts value {if (!value) throw new Error(message);}
const syntheticToken = 'fixture-lifecycle-token-NOT-A-REAL-CREDENTIAL';
const syntheticUser = 'synthetic-lifecycle-user';
const endpoint = 'http://127.0.0.1:9';

export default function NativeRuntimeLifecycleFixtureApp() {
  const [status, setStatus] = useState('Preparing native lifecycle verification');
  useEffect(() => {
    let alive = true, dispose: (() => Promise<void>) | undefined;
    const run = async () => {
      check(__DEV__ && Platform.OS === 'ios', 'Lifecycle verification requires an iOS development fixture');
      const container = decodeURIComponent(Paths.document.uri).replace(/^file:\/\//, '').replace(/\/Documents\/?$/, '');
      const directory = `${container}/Library/Application Support`;
      const requestFile = new File(`file://${encodeURI(directory)}/native-runtime-lifecycle-request.json`);
      const request = JSON.parse(await requestFile.text()) as {kind: string; version: number; device: string; nonce: string; requestedAt: number};
      check(request.kind === 'slax-native-runtime-lifecycle' && request.version === 1 && /^[0-9A-Fa-f-]{36}$/.test(request.device) && /^[0-9a-f-]{36}$/.test(request.nonce), 'Unknown lifecycle fixture request');
      check(container.includes(`/CoreSimulator/Devices/${request.device}/data/Containers/Data/Application/`), 'Only the allocated simulator is allowed');
      check(Number.isFinite(request.requestedAt) && Date.now() >= request.requestedAt && Date.now() - request.requestedAt < 86_400_000, 'Lifecycle request is stale');
      const reportFile = new File(`file://${encodeURI(directory)}/native-runtime-lifecycle-report.json`);
      check(!reportFile.exists, 'Use a fresh lifecycle fixture installation');
      const bridge = loadLegacyBridge();
      const original = await bridge.readPreferences();
      check(Object.keys(original.values).length === 0 && await bridge.readLegacyPreferences() === null, 'Do not replace existing preferences');
      const inventory = await bridge.beginDataOwnership();
      try {check(inventory.scanComplete && inventory.databaseCandidates.length === 0, 'Do not open an existing database');}
      finally {await bridge.endDataOwnership();}
      const requests: string[] = [];
      const runtime = createMobileDataRuntime({platform: 'ios', version: 'controlled-lifecycle', baseUrl: endpoint, betaBaseUrl: endpoint, localSyncEndpoint: endpoint,
        fetch: async input => {
          const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url);
          check(url.origin === endpoint, 'Fixture request escaped the blocked loopback origin');
          requests.push(url.pathname);
          return new Response(JSON.stringify({code: 503, message: 'Synthetic offline lifecycle verification', data: null}), {status: 503, headers: {'Content-Type': 'application/json'}});
        },
      });
      let listener: ReturnType<typeof AppState.addEventListener> | undefined;
      dispose = async () => {listener?.remove(); await runtime.stop();};
      await runtime.preferences.update(values => {values.cache_count = 0; values.download_images = 0; values.user_language = 'en';});
      await runtime.start();
      await runtime.sessions.accept(syntheticToken, syntheticUser);
      const database = runtime.getDatabase(), repositories = runtime.getRepositories(), cache = runtime.getCache();
      const preferences = runtime.getAccountPreferences(), session = runtime.sessions.getSnapshot(), owner = runtime.getNativeResourceOwner();
      check(database && repositories && cache && preferences && owner && session.status === 'authenticated', 'Native runtime account is not ready');
      const bookmark = await repositories.createBookmark('https://lifecycle-fixture.test/article');
      await repositories.updateBookmark(bookmark, {aliasTitle: 'Native lifecycle offline bookmark'});
      await repositories.local.update(bookmark, {read_position: '123', future_field: {preserve: true}});
      cache.writeArticle(bookmark, '<html><body>Synthetic lifecycle article</body></html>');
      const pending = async () => {
        const operations: unknown[] = [];
        for await (const transaction of database.getCrudTransactions()) {
          operations.push({transactionId: transaction.transactionId, crud: transaction.crud.map(entry => ({clientId: entry.clientId, id: entry.id, op: entry.op, table: entry.table, opData: entry.opData ?? null, previousValues: entry.previousValues ?? null}))});
        }
        return operations;
      };
      const baseline = JSON.stringify(await pending());
      check(JSON.parse(baseline).length > 0, 'Synthetic offline operations were not queued');
      const transitions: {state: string; observedAt: number; completedAt?: number; verified?: boolean; error?: string}[] = [];
      let serial = Promise.resolve(), backgroundSeen = false, resumes = 0;
      const report = () => reportFile.write(JSON.stringify({kind: 'slax-native-runtime-lifecycle-report', version: 1, device: request.device, nonce: request.nonce,
        status: transitions.some(event => event.error) ? 'failed' : resumes > 0 ? 'passed' : 'ready', bookmark, owner, resumes, transitions,
        actualProductionRuntime: true, actualNativeStorage: true, realPowerSyncAndOpSqlite: true, pendingBaseline: JSON.parse(baseline), deniedRequestPaths: requests,
        networkRequestsForwarded: 0, physicalDeviceSuspensionVerified: false, crashCauseConfirmed: false}, null, 2));
      const fail = (error: unknown) => {const message = error instanceof Error ? error.message : String(error); if (alive) setStatus(`FAILED: ${message}`);};
      listener = AppState.addEventListener('change', state => {
        const entry: typeof transitions[number] = {state, observedAt: Date.now()};
        transitions.push(entry);
        const change = runtime.setForeground(state === 'active');
        void change.catch(() => undefined);
        serial = serial.then(async () => {
          await change;
          check(runtime.getDatabase() === database && runtime.getRepositories() === repositories && runtime.getCache() === cache && runtime.getAccountPreferences() === preferences, 'Background transition replaced account services');
          check(runtime.sessions.getSnapshot() === session && runtime.getNativeResourceOwner() === owner, 'Background transition replaced session or owner');
          if (state !== 'active') {
            backgroundSeen = true;
            await repositories.local.update(bookmark, {read_position: '456', future_field: {preserve: true}});
            await preferences.update(values => {values.continue_reading_bookmark = JSON.stringify({bookmarkId: bookmark, title: 'Native lifecycle offline bookmark'});});
          } else if (backgroundSeen) {
            check(JSON.stringify(await pending()) === baseline, 'Suspension changed the pending operation identifiers or data');
            const local = await repositories.local.read(bookmark);
            check(local.read_position === '456' && (local.future_field as {preserve?: boolean})?.preserve === true, 'Position or local metadata was lost');
            check((await cache.readArticle(bookmark))?.includes('Synthetic lifecycle article'), 'Cached article was lost');
            const values = await preferences.read();
            check(values.auth_token === syntheticToken && values.user_id === syntheticUser, 'Synthetic session was lost');
            resumes++; backgroundSeen = false;
          }
          entry.completedAt = Date.now(); entry.verified = true; report();
          if (alive) setStatus(resumes ? `Native lifecycle passed: ${resumes}` : 'Native lifecycle ready');
        }).catch(error => {entry.error = error instanceof Error ? error.message : String(error); report(); fail(error);});
      });
      report();
      if (alive) setStatus('Native lifecycle ready');
      else await dispose();
    };
    void run().catch(error => {if (alive) setStatus(`FAILED: ${error instanceof Error ? error.message : String(error)}`); void dispose?.();});
    return () => {alive = false; void dispose?.();};
  }, []);
  return <ScrollView contentContainerStyle={{padding: 24}}><Text testID="native-runtime-lifecycle-status" selectable>{status}</Text></ScrollView>;
}
