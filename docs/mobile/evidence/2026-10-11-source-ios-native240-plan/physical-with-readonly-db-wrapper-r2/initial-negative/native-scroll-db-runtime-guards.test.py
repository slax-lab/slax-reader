#!/usr/bin/env python3
"""Actual wrapper with synthetic grants/records and mocked commands; no DB/native call."""
import importlib.util
import json
from pathlib import Path
import plistlib
import sys
import tempfile
import time
import unittest
from unittest.mock import Mock, patch

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('source_db_wrapper', HERE / 'run-native-scroll-with-db.py')
wrapper = importlib.util.module_from_spec(spec); spec.loader.exec_module(wrapper)
base = wrapper.base


class WrapperGuards(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='slax-source-db-wrapper-host-')
        self.root = Path(self.tmp.name).resolve()
        self.root_patch = patch.object(base, 'RUN_ROOT', self.root); self.root_patch.start()

    def tearDown(self):
        self.root_patch.stop(); self.tmp.cleanup()

    def executor(self):
        value = wrapper.DatabaseExecutor.__new__(wrapper.DatabaseExecutor)
        value.wrapper_plan = {}; value.database_grant = {}; value.database_path = self.root / 'db-grant.json'
        value.database_sha = 'd' * 64; value.physical_path = self.root / 'physical-grant.json'
        value.helper = Mock(MAX_SECONDS=12, FIXTURE_SHA='a' * 64, SOURCE_SHA='b' * 64)
        value.db = None; value.data_root = self.root / 'synthetic-data'; value.launched_unix = time.time()
        value.launched = time.monotonic(); value.started = time.monotonic()
        value.identity = '00000000-0000-4000-8000-000000000001'
        value.launch_evidence = None; value.last_input = None; value.measurements = []
        value.commands = []; value.database_records = []; value.used = set()
        value.receipt = {'separateReadonlyDatabaseSupplement': {}}
        value.resources = Mock(); value.save = Mock(); value.remaining = Mock(return_value=180)
        return value

    def grant(self):
        physical = self.root / 'physical-grant.json'; physical.write_text('{"known":"synthetic"}')
        path = self.root / 'db-grant.json'
        plan_path = self.root / 'wrapper-plan.json'; plan_path.write_text('{"prepared":true}')
        value = {'kind': 'root-authorized-original-source-readonly-persisted-position',
            'device': base.DEVICE, 'bundleIdentifier': base.SOURCE_ID, 'observationNonce': base.NONCE,
            'fixtureInputSha256': 'aaf4fdd7fd8b205ed6f2e297686f20bb3f523b680d35fc62effcdc8a2a4afe2f',
            'onlyRowId': '00000003-0000-4000-8000-000000000001', 'mode': 'ro', 'maxSnapshots': 8,
            'maxObservationSeconds': 12, 'helperSHA256': base.sha(wrapper.HELPER_PATH),
            'physicalGrantSHA256': base.sha(physical), 'physicalExecutorSHA256': wrapper.BASE_SHA,
            'wrapperSHA256': base.sha(HERE / 'run-native-scroll-with-db.py'),
            'wrapperPlanSHA256': base.sha(plan_path), 'physicalGrantPath': str(physical),
            'runRoot': str(self.root), 'oneLaunchOnly': True, 'noDatabaseWrites': True,
            'expiresAtUnixSeconds': time.time() + 180}
        return physical, path, plan_path, value

    def test_separate_grant_exact_bindings_and_expiry(self):
        physical, path, plan_path, value = self.grant()
        with patch.object(wrapper, 'PLAN', plan_path):
            for changes in [{}, {'mode': 'rw'}, {'helperSHA256': '0' * 64}, {'wrapperSHA256': '0' * 64},
                            {'physicalGrantSHA256': '0' * 64}, {'expiresAtUnixSeconds': float('inf')},
                            {'expiresAtUnixSeconds': time.time() - 1}, {'onlyRowId': 'arbitrary'}]:
                altered = dict(value, **changes); path.write_text(json.dumps(altered))
                args = (path, base.sha(path), {'databaseAllocationPath': str(path)}, physical, base.sha(physical))
                if changes:
                    with self.assertRaises(ValueError): wrapper.database_allocation(*args)
                else:
                    self.assertEqual(wrapper.database_allocation(*args), value)

    def test_launch_pid_requires_actual_exact_source_stdout(self):
        self.assertEqual(wrapper.launch_pid((base.SOURCE_ID + ': 12345\n').encode()), 12345)
        for raw in [b'app.slax.reader: 12\n', b'app.slax.reader.sourcefixture: 0\n',
                    b'app.slax.reader.sourcefixture: 12\nother: 13\n', b'x' * 1025]:
            with self.assertRaises(ValueError): wrapper.launch_pid(raw)

    def test_exact_one_passed_modern_native_leaf(self):
        expected = {'nodeType': 'Test Case', 'nodeIdentifier':
            'SourceFixtureNativeScrollControl/testPerformOneMeasuredOriginalReaderNativeDrag()', 'result': 'Passed'}
        value = {'testNodes': [{'nodeType': 'Test Plan', 'children': [expected]}]}
        self.assertEqual(wrapper.exact_completed_leaf(value), expected['nodeIdentifier'])
        for wrong in [dict(expected, result='Failed'), dict(expected, nodeIdentifier='Other/test()')]:
            with self.assertRaises(ValueError): wrapper.exact_completed_leaf({'testNodes': [wrong]})
        with self.assertRaises(ValueError): wrapper.exact_completed_leaf({'testNodes': [expected, expected]})

    def test_native_command_requires_actual_zero_before_any_process(self):
        value = self.executor()
        with patch.object(base.Executor, 'command', side_effect=AssertionError('Unexpected native process')):
            with self.assertRaisesRegex(ValueError, 'stored-zero'): value.command(base.test_command(1), 25)
        value.resources.assert_not_called()

    def test_launch_baseline_precedes_exact_process_and_pid_is_bound(self):
        value = self.executor(); order = []
        observer = Mock(); observer.capture_before_launch.side_effect = lambda now: order.append('filenames') or {'noDatabaseRead': True}
        value.helper.PersistedPositionObserver.return_value = observer
        stdout = self.root / 'launch.stdout'; stdout.write_text(base.SOURCE_ID + ': 2468\n')
        def command(instance, argv, seconds, release=False):
            order.append('native-launch')
            instance.commands.append({'exitCode': 0, 'stopped': None})
            return stdout
        launch = [base.XCRUN, 'simctl', 'launch', '--terminate-running-process', base.DEVICE, base.SOURCE_ID,
            '--scenario', 'reader-mixed', '--fixture-locale', 'en', '--fixture-action-index', '-1',
            '--fixture-reader-step', 'none', '--fixture-native-scroll-observation', base.NONCE,
            '-AppleLanguages', '(en)', '-AppleLocale', 'en_US']
        with patch.object(base.Executor, 'command', new=command):
            value.command(launch, 10)
        self.assertEqual(order, ['filenames', 'native-launch'])
        self.assertEqual(value.launch_evidence['pid'], 2468)
        self.assertEqual(value.launch_evidence['rawLaunchStdout']['sha256'], base.sha(stdout))
        observer.observe_zero_before_input.assert_not_called()
        with self.assertRaisesRegex(ValueError, 'Only one'): value.command(launch, 10)

    def test_initial_phase_checks_zero_before_any_native_input(self):
        value = self.executor(); order = []; value.db = Mock(); value.db.records = []
        value.db.spent_seconds = 0
        value.launch_evidence = {'pid': 2}
        value.db.bind_fresh_launch.side_effect = lambda launch: order.append('bind') or {'noDatabaseRead': True}
        value.db.observe_zero_before_input.side_effect = lambda observation: order.append('actual-zero') or {'readPosition': '0.0'}
        value.db_record = Mock()
        with patch.object(base.Executor, 'keep_observation', return_value={'path': 'synthetic'}):
            value.keep_observation('initial', b'{"ready":true}')
        self.assertEqual(order, ['bind', 'actual-zero'])
        self.assertEqual(value.db_record.call_args.args[0], 'actual-stored-zero')

    def test_failed_zero_preserves_rejected_snapshot_and_refuses(self):
        value = self.executor(); value.db = Mock(); value.db.records = []
        value.db.spent_seconds = 0
        def read():
            value.db.records.append({'readPosition': '240.0', 'synthetic': True})
            raise ValueError('Seed240 cannot be zero')
        with self.assertRaisesRegex(ValueError, 'Seed240'):
            value.sql_call('actual-stored-zero', read, {'sha256': 'a' * 64})
        record = value.database_records[0]
        self.assertIn('rejected-snapshot', record['label'])
        self.assertEqual(json.loads(Path(record['path']).read_text())['readPosition'], '240.0')
        self.assertIn('Seed240', value.receipt['separateReadonlyDatabaseSupplement']['refusal'])

    def test_sql_reserve_stops_before_query(self):
        value = self.executor(); value.remaining.return_value = 39
        with self.assertRaisesRegex(ValueError, 'reserve'): value.require_sql_reserve()
        value.resources.assert_not_called()

    def test_gesture_retains_original30_69_admission_without_speculative108_gate(self):
        value = self.executor(); value.db = Mock(); value.db.zero = {'readPosition': '0.0'}
        value.remaining.return_value = 69
        original = {'samples': [{'elapsedSeconds': 30}]}
        with patch.object(base.Executor, 'one_gesture', return_value='original-admission-only') as gesture:
            self.assertEqual(value.one_gesture(1, b'{}', original), 'original-admission-only')
        gesture.assert_called_once_with(1, b'{}', original)

    def test_wrapper_sql_deadline_and_whitelist_do_not_open_any_database(self):
        connection = Mock(); connection.execute.return_value.fetchone.return_value = ('synthetic',)
        sqlite = Mock(); sqlite.connect.return_value = connection
        helper = Mock(QUERY='fixed SQL', ROW_ID='fixed-id'); boundary = Mock()
        deadline = time.monotonic() + 1
        facade = wrapper.DeadlineSqlite(sqlite, helper, deadline, boundary)
        wrapped = facade.connect('file:///synthetic-fixture.db?mode=ro', uri=True, timeout=.25)
        self.assertEqual(wrapped.execute('fixed SQL', ('fixed-id',)).fetchone(), ('synthetic',))
        with self.assertRaisesRegex(ValueError, 'fixed readonly'):
            wrapped.execute('UPDATE arbitrary SET x=1')
        callback = Mock(return_value=0); wrapped.set_progress_handler(callback, 1000)
        progress, instructions = connection.set_progress_handler.call_args.args
        self.assertEqual(instructions, 100)
        with patch.object(wrapper.time, 'monotonic', return_value=deadline + .01):
            self.assertEqual(progress(), 1)
        callback.assert_not_called()
        self.assertIn('deadline', facade.interrupted_reason)
        wrapped.close(); connection.close.assert_called_once()

    def test_expired_sql_budget_stops_before_connect(self):
        sqlite = Mock()
        facade = wrapper.DeadlineSqlite(sqlite, Mock(), time.monotonic() - 1, Mock())
        with self.assertRaisesRegex(ValueError, 'deadline'):
            facade.connect('file:///synthetic-fixture.db?mode=ro', uri=True, timeout=.25)
        sqlite.connect.assert_not_called()

    def test_candidate_without_completed_genuine_input_never_reads(self):
        value = self.executor(); value.db = Mock(); value.db.zero = {'readPosition': '0.0'}
        with self.assertRaisesRegex(ValueError, 'completed genuine'): value.observe_persisted_candidate()
        value.db.observe_after_genuine_input.assert_not_called()

    def prepared_candidate(self):
        value = self.executor(); value.db = Mock(); value.db.zero = {'readPosition': '0.0'}; value.db.records = []
        value.db.attempts = 2; value.db.spent_seconds = .01; value.db.returned_bytes = 20
        value.db.observe_after_genuine_input.return_value = {'readPosition': '240.0',
            'persistedTransitionObserved': 'stored0.0 -> genuine-native-input -> stored240.0'}
        value.last_input = {'index': 1, 'commandCompletedAtUnixSeconds': time.time() - 2.2}
        request = self.root / 'request-1.json'; request.write_text('{"beforeNativeKvoEventCount":1}')
        tests = self.root / 'raw-tests.json'; tests.write_text(json.dumps({'testNodes': [{
            'nodeType': 'Test Case', 'nodeIdentifier':
            'SourceFixtureNativeScrollControl/testPerformOneMeasuredOriginalReaderNativeDrag()', 'result': 'Passed'}]}))
        summary = self.root / 'summary.json'; summary.write_text('{"result":"Passed"}')
        info = self.root / 'request-1.xcresult/Info.plist'; info.parent.mkdir(); info.write_bytes(plistlib.dumps({'rootId': 'synthetic'}))
        value.measurements = [{'gestureIndex': 1, 'rawCGFloatExact240': True, 'float32ArithmeticEquals240': True,
            'rawTests': {'path': str(tests), 'sha256': base.sha(tests)},
            'rawSummary': {'path': str(summary), 'sha256': base.sha(summary)},
            'completedInfoSHA256': base.sha(info), 'requestSHA256': base.sha(request)}]
        fresh = {'samples': [{'geometry': {'positionPixels': 240, 'sourceCallbackFloat32PositionPixels': 240}}]}
        value.wait_observation = Mock(return_value=(json.dumps(fresh).encode(), fresh))
        value.observation = Mock(return_value=(json.dumps(fresh).encode(), fresh))
        return value

    def test_candidate_uses_fresh_debounced_observation_actual_request_and_raw_test(self):
        value = self.prepared_candidate()
        with patch.object(base.Executor, 'keep_observation', return_value={'path': 'fresh-synthetic', 'sha256': 'f' * 64}):
            value.observe_persisted_candidate()
        fresh, completed = value.db.observe_after_genuine_input.call_args.args
        self.assertEqual(fresh['samples'][0]['geometry']['positionPixels'], 240)
        self.assertEqual(completed['beforeNativeKvoEventCount'], 1)
        self.assertFalse(completed['programmaticScroll'])
        self.assertEqual(completed['nativeTests'], {'total': 1, 'passed': 1, 'failed': 0, 'skipped': 0})
        self.assertTrue(value.receipt['persistedPositionRead'])
        self.assertNotIn('native240Accepted', value.receipt)
        self.assertEqual(value.database_records[-1]['rawNativeObservationFile']['path'], 'fresh-synthetic')
        self.assertTrue(value.receipt['separateReadonlyDatabaseSupplement']['nativeCandidateRemainedAfterSQL'])

    def test_tampered_actual_native_summary_stops_before_db_query(self):
        value = self.prepared_candidate()
        Path(value.measurements[0]['rawSummary']['path']).write_text('{"result":"Failed"}')
        with self.assertRaisesRegex(ValueError, 'summary changed'): value.observe_persisted_candidate()
        value.db.observe_after_genuine_input.assert_not_called()

    def test_native_geometry_drift_after_debounce_is_not_replaced_with_db240(self):
        value = self.prepared_candidate()
        wrong = {'samples': [{'geometry': {'positionPixels': 237, 'sourceCallbackFloat32PositionPixels': 237}}]}
        value.wait_observation.return_value = (json.dumps(wrong).encode(), wrong)
        with self.assertRaisesRegex(ValueError, 'changed during'): value.observe_persisted_candidate()
        value.db.observe_after_genuine_input.assert_not_called()

    def test_sql240_does_not_override_changed_actual_native_geometry(self):
        value = self.prepared_candidate()
        wrong = {'samples': [{'geometry': {'positionPixels': 237, 'sourceCallbackFloat32PositionPixels': 237}}]}
        value.observation.return_value = (json.dumps(wrong).encode(), wrong)
        with patch.object(base.Executor, 'keep_observation', return_value={'path': 'fresh-synthetic', 'sha256': 'f' * 64}):
            with self.assertRaisesRegex(ValueError, 'changed during SQL'): value.observe_persisted_candidate()
        self.assertTrue(value.receipt['persistedPositionRead'])
        self.assertNotIn('nativeCandidateRemainedAfterSQL', value.receipt['separateReadonlyDatabaseSupplement'])

    def test_bounded_record_and_raw_observation_reference(self):
        value = self.executor(); observed = {'path': 'synthetic-only', 'sha256': 'b' * 64}
        record = value.db_record('synthetic-zero', {'readPosition': '0.0'}, observed)
        self.assertEqual(record['rawNativeObservationFile'], observed)
        self.assertEqual(record['sha256'], base.sha(Path(record['path'])))
        with self.assertRaisesRegex(ValueError, 'bounded|Bounded'):
            value.db_record('oversized', {'value': 'x' * wrapper.RECORD_CAP})

    def test_default_mode_creates_no_executor_or_queries(self):
        with patch.object(wrapper, 'admission', return_value=({}, Mock(), ())), \
             patch.object(wrapper, 'DatabaseExecutor', side_effect=AssertionError('Must not execute')), \
             patch.object(sys, 'argv', ['run-native-scroll-with-db.py']):
            self.assertEqual(wrapper.main(), 0)

    def test_execute_requires_both_grants_before_executor_creation(self):
        with patch.object(wrapper, 'admission', return_value=({}, Mock(), ())), \
             patch.object(wrapper, 'DatabaseExecutor', side_effect=AssertionError('Must not execute')), \
             patch.object(sys, 'argv', ['run-native-scroll-with-db.py', '--execute']):
            with self.assertRaisesRegex(ValueError, 'Both separate'): wrapper.main()


if __name__ == '__main__': unittest.main()
