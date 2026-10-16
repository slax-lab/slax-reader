#!/usr/bin/env python3
"""Actual fixed helper + synthetic SQLite/WAL fixtures only; no app DB/native tools."""
import importlib.util
import json
from pathlib import Path
import plistlib
import sqlite3
import tempfile
import time
import unittest
from unittest.mock import patch
from uuid import uuid4

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('persisted_position', HERE / 'observe-persisted-position.py')
helper = importlib.util.module_from_spec(spec); spec.loader.exec_module(helper)


class FixedRowTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='slax-source-db-host-')
        self.root = Path(self.tmp.name).resolve()
        self.device_root = self.root / helper.DEVICE
        self.patch_root = patch.object(helper, 'DEVICE_ROOT', self.device_root); self.patch_root.start()
        self.data = self.device_root / 'data/Containers/Data/Application' / str(uuid4()).upper()
        self.data.mkdir(parents=True)
        (self.data / '.com.apple.mobile_container_manager.metadata.plist').write_bytes(plistlib.dumps({'MCMMetadataIdentifier': helper.BUNDLE}))
        self.nonce = str(uuid4()); self.physical = self.root / 'physical-grant.json'; self.grant = self.root / 'db-grant.json'
        self.physical_value = {'kind': 'root-one-source-physical-native-scroll-allocation', 'device': helper.DEVICE,
                               'observationNonce': self.nonce, 'executorSHA256': 'a' * 64, 'attempts': 1,
                               'exclusiveDeviceLoan': True, 'expiresAtUnixSeconds': time.time() + 180,
                               'onlyTestIdentifier': 'SourceFixtureControl/SourceFixtureNativeScrollControl/testPerformOneMeasuredOriginalReaderNativeDrag'}
        self.physical.write_text(json.dumps(self.physical_value))
        self.grant_value = {'kind': 'root-authorized-original-source-readonly-persisted-position', 'device': helper.DEVICE,
                            'bundleIdentifier': helper.BUNDLE, 'observationNonce': self.nonce, 'fixtureInputSha256': helper.FIXTURE_SHA,
                            'onlyRowId': helper.ROW_ID, 'mode': 'ro', 'maxSnapshots': 8, 'maxObservationSeconds': 12,
                            'helperSHA256': helper.digest((HERE / 'observe-persisted-position.py').read_bytes()),
                            'physicalGrantSHA256': helper.digest(self.physical.read_bytes()), 'physicalExecutorSHA256': 'a' * 64,
                            'expiresAtUnixSeconds': time.time() + 180}
        self.grant.write_text(json.dumps(self.grant_value)); self.connections = []

    def tearDown(self):
        for connection in self.connections: connection.close()
        self.patch_root.stop(); self.tmp.cleanup()

    def observer(self):
        return helper.PersistedPositionObserver(self.data, self.nonce, self.grant, self.physical)

    def database(self, position='0.0', metadata='real-startup-metadata'):
        directory = self.data / helper.RELATIVE_DIRECTORY; directory.mkdir(parents=True, exist_ok=True)
        path = directory / ('ui-fixture-' + str(uuid4()).upper() + '.db')
        connection = sqlite3.connect(path); self.connections.append(connection)
        connection.execute('PRAGMA journal_mode=WAL'); connection.execute('PRAGMA wal_autocheckpoint=0')
        connection.execute('CREATE TABLE ps_data_local__local_bookmark_info(id TEXT PRIMARY KEY,data TEXT)')
        value = {'id': helper.ROW_ID, 'read_position': position, 'overview': metadata, 'is_downloaded': 1}
        connection.execute('INSERT INTO ps_data_local__local_bookmark_info VALUES(?,?)', (helper.ROW_ID, json.dumps(value)))
        connection.commit(); return path, connection

    def prepared(self, position='0.0'):
        observer = self.observer(); before = time.time(); observer.capture_before_launch(before)
        path, writer = self.database(position)
        launch = {'observationNonce': self.nonce, 'bundleIdentifier': helper.BUNDLE, 'fixtureInputSha256': helper.FIXTURE_SHA,
                  'sourceManifestSha256': helper.SOURCE_SHA, 'pid': 123, 'launchedAtUnixSeconds': before}
        observer.bind_fresh_launch(launch)
        return observer, path, writer

    def observation(self, events=1):
        return {'kind': 'original-source-native-reader-observation', 'controlledFixture': True, 'fixtureVersion': 1,
                'bundleIdentifier': helper.BUNDLE, 'observationNonce': self.nonce, 'state': 'observing',
                'webIdentity': '00000000-0000-4000-8000-000000000001', 'nativeKvoEventCount': events,
                'sourcePreparedStatus': {'controlledFixture': True, 'fixtureVersion': 1, 'state': 'prepared',
                    'scenario': 'reader-mixed', 'route': 'Reader', 'locale': 'en', 'selectedActionIndex': -1,
                    'fixtureInputSha256': helper.FIXTURE_SHA, 'sourceManifestSha256': helper.SOURCE_SHA},
                'samples': [{'bodyAndBridgeReady': True, 'observedAtUnixSeconds': time.time(),
                    'geometry': {'frameInWindow': {'x': 0, 'y': 0, 'width': 402, 'height': 874},
                                 'loading': False, 'dragging': False, 'decelerating': False}}]}

    def completed(self, zero):
        return {'observationNonce': self.nonce, 'webIdentity': zero['webIdentity'], 'gestureIndex': 1,
                'programmaticScroll': False, 'inputEndedAtUnixSeconds': zero['observedAtUnixSeconds'] + .1,
                'nativeTests': {'total': 1, 'passed': 1, 'failed': 0, 'skipped': 0}, 'beforeNativeKvoEventCount': 1,
                'onlyTestIdentifier': 'SourceFixtureControl/SourceFixtureNativeScrollControl/testPerformOneMeasuredOriginalReaderNativeDrag'}

    def after(self, observer, zero, completed=None):
        completed = completed or self.completed(zero)
        with patch.object(helper.time, 'time', return_value=zero['observedAtUnixSeconds'] + 2.2):
            return observer.observe_after_genuine_input(self.observation(3), completed)

    def test_prelaunch_and_birth_binding_do_not_open_sqlite(self):
        observer = self.observer(); before = time.time()
        with patch.object(helper.sqlite3, 'connect', side_effect=AssertionError('SQL before ready')):
            observer.capture_before_launch(before)
        self.database()
        with patch.object(helper.sqlite3, 'connect', side_effect=AssertionError('SQL before ready')):
            observer.bind_fresh_launch({'observationNonce': self.nonce, 'bundleIdentifier': helper.BUNDLE,
                'fixtureInputSha256': helper.FIXTURE_SHA, 'sourceManifestSha256': helper.SOURCE_SHA, 'pid': 123, 'launchedAtUnixSeconds': before})

    def test_separate_exact_grant_is_mandatory(self):
        self.grant_value['mode'] = 'rw'; self.grant.write_text(json.dumps(self.grant_value))
        with self.assertRaisesRegex(ValueError, 'Separate fixed-row'): self.observer()

    def test_wrong_container_and_symlink_are_refused(self):
        (self.data / '.com.apple.mobile_container_manager.metadata.plist').write_bytes(plistlib.dumps({'MCMMetadataIdentifier': 'app.slax.reader'}))
        with self.assertRaisesRegex(ValueError, 'isolated'): self.observer()
        link = self.root / 'alias'; link.symlink_to(self.data)
        with self.assertRaises(ValueError): helper.checked_path(link, directory=True)

    def test_multiple_new_database_names_are_not_newest_selection(self):
        observer = self.observer(); before = time.time(); observer.capture_before_launch(before)
        self.database(); self.database()
        with self.assertRaisesRegex(ValueError, 'exactly one'):
            observer.bind_fresh_launch({'observationNonce': self.nonce, 'bundleIdentifier': helper.BUNDLE,
                'fixtureInputSha256': helper.FIXTURE_SHA, 'sourceManifestSha256': helper.SOURCE_SHA, 'pid': 123, 'launchedAtUnixSeconds': before})

    def test_missing_existing_wal_shm_refuses_before_sqlite_read(self):
        observer, path, writer = self.prepared(); Path(str(path) + '-shm').unlink()
        with patch.object(helper.sqlite3, 'connect', side_effect=AssertionError('Must not open')):
            with self.assertRaises(FileNotFoundError): observer.observe_zero_before_input(self.observation())

    def test_seed240_is_not_zero_outcome(self):
        observer, _, _ = self.prepared('240.0')
        with self.assertRaisesRegex(ValueError, 'Seed240'): observer.observe_zero_before_input(self.observation())
        self.assertIsNone(observer.zero)

    def test_actual_zero_metadata_then_genuine_persisted240(self):
        observer, path, writer = self.prepared(); zero = observer.observe_zero_before_input(self.observation())
        before = [helper.file_identity(Path(str(path) + suffix)) for suffix in ('', '-wal', '-shm')]
        writer.execute("UPDATE ps_data_local__local_bookmark_info SET data=json_set(data,'$.read_position','240.0') WHERE id=?", (helper.ROW_ID,)); writer.commit()
        result = self.after(observer, zero)
        self.assertFalse(result['directKotlinCallbackCaptured']); self.assertEqual(result['readPosition'], '240.0')
        self.assertEqual(result['otherFieldsSHA256'], zero['otherFieldsSHA256'])
        self.assertTrue(all(helper.same_file(a, helper.file_identity(Path(str(path) + suffix))) for a, suffix in zip(before, ('', '-wal', '-shm'))))

    def test_changed_nonposition_data_refuses_transition(self):
        observer, _, writer = self.prepared(); zero = observer.observe_zero_before_input(self.observation())
        writer.execute("UPDATE ps_data_local__local_bookmark_info SET data=json_set(data,'$.read_position','240.0','$.overview','changed') WHERE id=?", (helper.ROW_ID,)); writer.commit()
        with self.assertRaisesRegex(ValueError, 'Other fixed-row'): self.after(observer, zero)

    def test_failed_programmatic_or_wrong_nonce_input_refuses_before_query(self):
        observer, _, _ = self.prepared(); zero = observer.observe_zero_before_input(self.observation())
        for change in [{'programmaticScroll': True}, {'observationNonce': str(uuid4())}, {'nativeTests': {'total': 1, 'passed': 0, 'failed': 1, 'skipped': 0}}]:
            value = self.completed(zero); value.update(change)
            with patch.object(helper.sqlite3, 'connect', side_effect=AssertionError('No new SQL')):
                with self.assertRaisesRegex(ValueError, 'genuine'): self.after(observer, zero, value)

    def test_stale_and_wrong_source_observations_refuse_before_query(self):
        observer, _, _ = self.prepared()
        observation = self.observation(); observation['samples'][0]['observedAtUnixSeconds'] -= 3
        with self.assertRaisesRegex(ValueError, 'stale'): observer.observe_zero_before_input(observation)
        observation = self.observation(); observation['sourcePreparedStatus']['fixtureInputSha256'] = 'b' * 64
        with self.assertRaisesRegex(ValueError, 'route/input'): observer.observe_zero_before_input(observation)

    def test_actual_sqlite_uses_readonly_uri_and_fixed_parameter_query(self):
        observer, _, _ = self.prepared(); original = helper.sqlite3.connect; calls = []; traces = []
        def connect(database_uri, **kwargs):
            calls.append((database_uri, kwargs)); connection = original(database_uri, **kwargs); connection.set_trace_callback(traces.append); return connection
        with patch.object(helper.sqlite3, 'connect', side_effect=connect): observer.observe_zero_before_input(self.observation())
        self.assertTrue(calls[0][0].endswith('?mode=ro')); self.assertNotIn('immutable', calls[0][0]); self.assertEqual(calls[0][1]['timeout'], .25)
        self.assertEqual(len(traces), 2); self.assertEqual(traces[0], 'PRAGMA query_only=ON')
        self.assertIn('WHERE id=\'' + helper.ROW_ID + '\' LIMIT 1', traces[1]); self.assertNotIn('UPDATE', traces[1])

    def test_eight_failed_reads_consume_budget(self):
        observer, _, _ = self.prepared('240.0')
        for _ in range(8):
            with self.assertRaisesRegex(ValueError, 'Seed240'): observer.observe_zero_before_input(self.observation())
        with self.assertRaisesRegex(ValueError, 'budget'): observer.observe_zero_before_input(self.observation())
        self.assertEqual(observer.attempts, 8)

    def test_elapsed_sqlite_budget_rejects_result(self):
        observer, _, _ = self.prepared()
        with patch.object(helper.time, 'monotonic', side_effect=[100, 113]):
            with self.assertRaisesRegex(ValueError, 'time exceeded'): observer.observe_zero_before_input(self.observation())

    def test_large_row_is_bounded_by_actual_fixed_sqlite_query(self):
        observer, _, writer = self.prepared(); writer.execute("UPDATE ps_data_local__local_bookmark_info SET data=json_set(data,'$.overview',?) WHERE id=?", ('x' * 70000, helper.ROW_ID)); writer.commit()
        with self.assertRaisesRegex(ValueError, 'bounded fixed local row'): observer.observe_zero_before_input(self.observation())


if __name__ == '__main__': unittest.main()
