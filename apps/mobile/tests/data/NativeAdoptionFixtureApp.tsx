import React, {useEffect, useState} from 'react';
import {Platform, ScrollView, Text} from 'react-native';
import {File, Paths} from 'expo-file-system';
import {createMobileDataRuntime} from '../../src/data/runtime';

export default function NativeAdoptionFixtureApp() {
  const [result, setResult] = useState('Checking legacy reset…');
  useEffect(() => {
    let runtime: ReturnType<typeof createMobileDataRuntime> | undefined;
    const run = async () => {
      if (!__DEV__ || (Platform.OS !== 'android' && Platform.OS !== 'ios')) throw new Error('Native development fixture required');
      const container = decodeURIComponent(Paths.document.uri).replace('file://', '').split('/Documents')[0];
      const directory = Platform.OS === 'android' ? '/data/user/0/com.slax.reader/files' : `${container}/Library/Application Support`;
      const marker = JSON.parse(await new File(`file://${directory}/legacy-fixture-report.json`).text());
      if (marker.controlledFixture !== true || marker.producer !== 'powersync-kotlin-1.14.1') throw new Error('Original synthetic installation required');
      runtime = createMobileDataRuntime({baseUrl: 'http://127.0.0.1:9', betaBaseUrl: 'http://127.0.0.1:9', platform: Platform.OS, version: 'reset-fixture', network: {read: async () => ({isConnected: false, isInternetReachable: false}), subscribe: () => () => {}}});
      await runtime.start();
      const database = runtime.getDatabase();
      if (!database) throw new Error('New database did not open');
      const queue = await database.get<{count: number}>('SELECT count(*) AS count FROM ps_crud');
      const local = await database.get<{count: number}>('SELECT count(*) AS count FROM ps_data_local__local_bookmark_info');
      if (queue.count !== 0 || local.count !== 0) throw new Error('Old local data survived reset');
      await runtime.sessions.signOut();
      await runtime.sessions.accept('fixture-auth-token-NOT-A-REAL-CREDENTIAL', 'synthetic-user');
      await database.execute('INSERT INTO sr_user_tag(id,user_id,tag_name,display) VALUES(?,?,?,?)', ['reset-new-tag', 'synthetic-user', 'offline-new', 'Offline new']);
      const written = await database.get<{count: number}>('SELECT count(*) AS count FROM ps_crud');
      await runtime.stop(); await runtime.start();
      const reopened = runtime.getDatabase();
      if (!reopened) throw new Error('Database did not reopen');
      const retained = await reopened.get<{count: number}>('SELECT count(*) AS count FROM ps_crud');
      if (!written.count || retained.count !== written.count) throw new Error('Restart discarded new writes');
      const report = {status: 'passed', platform: Platform.OS, upgrade: runtime.getUpgradeSnapshot().status, queue: queue.count, local: local.count, relogin: runtime.sessions.getSnapshot().status, newPendingAfterRestart: retained.count};
      new File(`file://${directory}/native-reset-report.json`).write(JSON.stringify(report));
      setResult(JSON.stringify(report, null, 2));
    };
    void run().catch(error => setResult(`FAILED: ${error.message}`));
    return () => {void runtime?.stop();};
  }, []);
  return <ScrollView contentContainerStyle={{padding: 24}}><Text selectable>{result}</Text></ScrollView>;
}
