#!/usr/bin/env python3
"""Separate prepare-only wrapper; execution requires physical and fixed-row DB grants."""
import argparse
import importlib.util
import json
import math
from pathlib import Path
import re
import sys
import time
from uuid import UUID

sys.dont_write_bytecode = True

HERE = Path(__file__).resolve().parent
PLAN = HERE / 'native-scroll-db-runtime-plan.json'
BASE_PATH = HERE / 'run-native-scroll.py'
HELPER_PATH = HERE / 'observe-persisted-position.py'
BASE_SHA = '135bac87ef03df564958dd04657a8a705fb5c0f10524de2d05c1040c4d9d6c04'
BASE_PLAN_SHA = 'd2c8eef0f51435e50a8846c804df41f16ab884533b281211980ac35206d9761a'
RECORD_CAP = 131072
ZERO_WAIT_PREDICATE = 'Seed240 or another position cannot satisfy actual stored-zero baseline'


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


base = load_module('frozen_source_physical_r1', BASE_PATH)


def admission():
    base.regular(PLAN)
    plan = json.loads(PLAN.read_text())
    base.require(plan.get('kind') == 'source-native-scroll-separate-readonly-db-wrapper-plan' and
                 plan.get('version') == 2, 'Wrong separate DB wrapper plan')
    base.require(base.sha(BASE_PATH) == BASE_SHA and base.sha(base.PLAN) == BASE_PLAN_SHA,
                 'Frozen physical r1 changed')
    base.require(plan.get('physicalExecutorSHA256') == BASE_SHA and
                 plan.get('physicalPlanSHA256') == BASE_PLAN_SHA and
                 plan.get('runRoot') == str(base.RUN_ROOT) and
                 plan.get('observationNonce') == base.NONCE and
                 plan.get('device') == base.DEVICE and
                 plan.get('selector') == base.SELECTOR and
                 plan.get('limits') == {'totalSeconds': 180, 'observerSeconds': 90, 'capBytes': base.CAP,
                                        'floorBytes': base.FLOOR, 'preFreeBytes': base.PRE_FREE,
                                        'releaseSeconds': 35, 'maximumGestureIndices': 3,
                                        'maxSqlSnapshots': 8, 'maxSqlSeconds': 12, 'maxRowBytes': 65536},
                 'DB wrapper cannot change physical scope or limits')
    for entry in plan['bindings']:
        base.bound(entry)
    physical = base.admission()
    helper = load_module('separate_source_readonly_db', HELPER_PATH)
    base.require(helper.DEVICE == base.DEVICE and helper.BUNDLE == base.SOURCE_ID and
                 (helper.MAX_SNAPSHOTS, helper.MAX_SECONDS, helper.MAX_ROW_BYTES) == (8, 12, 65536),
                 'Fixed helper scope changed')
    return plan, helper, physical


def database_allocation(path, expected_sha, plan, physical_path, physical_sha):
    base.require(path == Path(plan['databaseAllocationPath']) and len(expected_sha) == 64,
                 'Exact separate Root database allocation required')
    info = base.regular(path)
    base.require(info.st_size <= 16384, 'Oversize database allocation')
    base.bound({'path': str(path), 'bytes': info.st_size, 'sha256': expected_sha})
    value = json.loads(path.read_text())
    expected = {'kind': 'root-authorized-original-source-readonly-persisted-position',
                'device': base.DEVICE, 'bundleIdentifier': base.SOURCE_ID, 'observationNonce': base.NONCE,
                'fixtureInputSha256': 'aaf4fdd7fd8b205ed6f2e297686f20bb3f523b680d35fc62effcdc8a2a4afe2f',
                'onlyRowId': '00000003-0000-4000-8000-000000000001', 'mode': 'ro',
                'maxSnapshots': 8, 'maxObservationSeconds': 12, 'helperSHA256': base.sha(HELPER_PATH),
                'physicalGrantSHA256': physical_sha, 'physicalExecutorSHA256': BASE_SHA,
                'wrapperSHA256': base.sha(Path(__file__)), 'wrapperPlanSHA256': base.sha(PLAN),
                'physicalGrantPath': str(physical_path), 'runRoot': str(base.RUN_ROOT),
                'oneLaunchOnly': True, 'noDatabaseWrites': True}
    base.require(all(value.get(k) == v for k, v in expected.items()), 'Database allocation scope changed')
    base.require(type(value.get('expiresAtUnixSeconds')) in (int, float) and
                 math.isfinite(value['expiresAtUnixSeconds']) and
                 time.time() < value['expiresAtUnixSeconds'], 'Database allocation expired')
    return value


def launch_pid(raw):
    base.require(len(raw) <= 1024, 'Oversize actual simctl launch stdout')
    match = re.fullmatch(re.escape(base.SOURCE_ID) + r': ([1-9][0-9]*)\s*', raw.decode('utf-8'))
    base.require(match is not None, 'Actual source launch PID stdout is missing or ambiguous')
    return int(match.group(1))


def exact_completed_leaf(value):
    leaves = []
    def visit(node):
        base.require(type(node) is dict, 'Malformed raw native test node')
        children = node.get('children', [])
        base.require(type(children) is list, 'Malformed native test children')
        if node.get('nodeType') == 'Test Case':
            leaves.append(node)
        for child in children:
            visit(child)
    roots = value.get('testNodes')
    base.require(type(roots) is list, 'No raw native test nodes')
    for node in roots:
        visit(node)
    expected = 'SourceFixtureNativeScrollControl/testPerformOneMeasuredOriginalReaderNativeDrag()'
    base.require(len(leaves) == 1 and leaves[0].get('nodeIdentifier') in
                 (expected, 'SourceFixtureControl/' + expected) and leaves[0].get('result') == 'Passed',
                 'Raw completed test is not the exact one genuine native drag')
    return leaves[0]['nodeIdentifier']


def only_seed240_wait(error, records, before):
    if type(error) is not ValueError or str(error) != ZERO_WAIT_PREDICATE or len(records) != before + 1:
        return False
    record = records[-1]
    return (record.get('phase') == 'before-genuine-input' and record.get('readPosition') == '240.0' and
            record.get('valueType') == 'text' and record.get('rowId') == '00000003-0000-4000-8000-000000000001')


class DeadlineSqlite:
    """Helper-local facade; exact readonly SQL with an earlier shared-window deadline."""
    def __init__(self, sqlite_module, helper, deadline, boundary):
        self.sqlite_module, self.helper, self.deadline, self.boundary = sqlite_module, helper, deadline, boundary
        self.interrupted_reason = None

    def check(self):
        base.require(time.monotonic() < self.deadline, 'Shared original SQL/observer/release deadline reached')
        self.boundary()

    def connect(self, database_uri, **kwargs):
        self.check()
        base.require(type(database_uri) is str and database_uri.endswith('?mode=ro') and kwargs.get('uri') is True and
                     set(kwargs) == {'uri', 'timeout'}, 'Only helper readonly URI connection permitted')
        kwargs['timeout'] = min(kwargs['timeout'], .25, max(0, self.deadline - time.monotonic()))
        connection = self.sqlite_module.connect(database_uri, **kwargs)
        facade = self
        class Connection:
            def execute(self, sql, parameters=()):
                facade.check()
                base.require((sql == 'PRAGMA query_only=ON' and parameters == ()) or
                             (sql == facade.helper.QUERY and parameters == (facade.helper.ROW_ID,)),
                             'Only fixed readonly helper SQL permitted')
                cursor = connection.execute(sql, parameters)
                facade.check()
                class Cursor:
                    def fetchone(self):
                        facade.check(); value = cursor.fetchone(); facade.check(); return value
                return Cursor()
            def set_progress_handler(self, original, instructions):
                def progress():
                    try:
                        facade.check()
                        return original()
                    except Exception as error:
                        facade.interrupted_reason = type(error).__name__ + ': ' + str(error)
                        return 1
                connection.set_progress_handler(progress, min(instructions, 100))
            def close(self):
                # Always release the actual readonly SQLite connection, including
                # after a resource/deadline refusal. Never checkpoint or write SQL.
                connection.close()
        return Connection()


class DatabaseExecutor(base.Executor):
    def __init__(self, physical, physical_grant, wrapper_plan, helper, database_grant, database_path,
                 database_sha, physical_path):
        super().__init__(*physical, physical_grant)
        self.wrapper_plan, self.helper = wrapper_plan, helper
        self.database_grant, self.database_path, self.database_sha = database_grant, database_path, database_sha
        self.physical_path = physical_path
        self.db = None; self.launch_evidence = None; self.last_input = None; self.database_records = []
        self.receipt['separateReadonlyDatabaseSupplement'] = {
            'wrapperSHA256': base.sha(Path(__file__)), 'wrapperPlanSHA256': base.sha(PLAN),
            'helperSHA256': base.sha(HELPER_PATH), 'databaseAllocationSHA256': database_sha,
            'records': self.database_records, 'mode': 'ro', 'directKotlinCallbackCaptured': False,
            'persistedTransitionAccepted': False, 'ordinaryWalReaderMayUpdateShmLockMetadata': True}
        self.save()

    def db_record(self, label, value, observation_file=None):
        raw = (json.dumps(value, indent=2) + '\n').encode()
        base.require(len(raw) <= RECORD_CAP, 'Bounded fixed-row record exceeded')
        path = base.RUN_ROOT / 'readonly-db' / (label + '.json')
        path.parent.mkdir(exist_ok=True)
        with path.open('xb') as output:
            output.write(raw)
        record = {'label': label, 'path': str(path), 'bytes': len(raw), 'sha256': base.sha(path)}
        if observation_file is not None:
            record['rawNativeObservationFile'] = observation_file
        self.database_records.append(record); self.resources(); self.save()
        return record

    def command(self, argv, seconds, release=False):
        source_launch = argv[:6] == [base.XCRUN, 'simctl', 'launch', '--terminate-running-process',
                                    base.DEVICE, base.SOURCE_ID]
        native_index = next((i for i in range(1, 4) if argv == base.test_command(i)), None)
        if native_index is not None:
            base.require(not release and self.db is not None and self.db.zero is not None,
                         'Actual stored-zero baseline must precede every native input')
        if source_launch:
            base.exact_command(argv)
            base.require(not release and self.db is None and self.data_root is not None,
                         'Only one exact source launch can bind DB filenames')
            self.resources()
            self.db = self.helper.PersistedPositionObserver(self.data_root, base.NONCE,
                                                            self.database_path, self.physical_path)
            self.db_record('before-launch-filenames', self.db.capture_before_launch(self.launched_unix))
            invoked_at = time.time()
        result = super().command(argv, seconds, release)
        if source_launch:
            command_record = self.commands[-1]
            base.require(command_record['exitCode'] == 0 and command_record['stopped'] is None,
                         'Source launch was not completed successfully')
            self.launch_evidence = {'observationNonce': base.NONCE, 'bundleIdentifier': base.SOURCE_ID,
                'fixtureInputSha256': self.helper.FIXTURE_SHA, 'sourceManifestSha256': self.helper.SOURCE_SHA,
                'pid': launch_pid(result.read_bytes()), 'launchedAtUnixSeconds': invoked_at,
                'launchTimeMeaning': 'actual simctl command invocation lower bound, not process birth timestamp',
                'rawLaunchStdout': {'path': str(result), 'sha256': base.sha(result)},
                'rawLaunchCommandIndex': len(self.commands) - 1}
            self.db_record('actual-launch-command-evidence', self.launch_evidence)
        if native_index is not None:
            self.last_input = {'index': native_index, 'commandCompletedAtUnixSeconds': time.time(),
                               'rawCommandIndex': len(self.commands) - 1}
        return result

    def keep_observation(self, label, raw):
        observed_file = super().keep_observation(label, raw)
        if label == 'initial':
            base.require(self.db is not None and self.launch_evidence is not None,
                         'Actual launch evidence must precede the first DB query')
            self.resources()
            self.db_record('new-database-existing-sidecars', self.db.bind_fresh_launch(self.launch_evidence))
            self.observe_initial_zero()
        elif label == 'candidate':
            self.observe_persisted_candidate()
        return observed_file

    def observe_initial_zero(self):
        # Reserve the eighth allowed SQL snapshot for actual after-drag readback.
        # Only the exact rejected seed240 snapshot may wait for original debounce.
        for attempt in range(1, 8):
            self.require_sql_reserve()
            raw, _ = self.observation()
            observed_file = super().keep_observation(f'db-initial-native-attempt-{attempt}', raw)
            before = len(self.db.records)
            try:
                result = self.sql_call(f'actual-stored-zero-attempt-{attempt}',
                                       lambda: self.db.observe_zero_before_input(json.loads(raw)), observed_file)
                base.require(self.db.zero is not None and result.get('readPosition') == '0.0',
                             'Returned snapshot does not establish actual stored-zero')
                fresh_raw, _ = self.observation()
                super().keep_observation('db-initial-after-stored-zero', fresh_raw)
                self.receipt['separateReadonlyDatabaseSupplement']['actualZeroBeforeInput'] = True
                self.receipt['separateReadonlyDatabaseSupplement']['waitingForOriginalStoredZero'] = False
                self.save(); return result
            except Exception as error:
                if not only_seed240_wait(error, self.db.records, before):
                    raise
                supplement = self.receipt['separateReadonlyDatabaseSupplement']
                supplement.setdefault('transientSeed240Predicates', []).append({
                    'attempt': attempt, 'predicate': str(error), 'rejectedSnapshotLabel':
                    f'actual-stored-zero-attempt-{attempt}-rejected-snapshot-{before + 1}'})
                supplement.pop('refusal', None)
                supplement['waitingForOriginalStoredZero'] = True; self.save()
                base.require(attempt < 7 and self.db.attempts < 7,
                             'Actual stored0 unavailable within7 initial SQL snapshots; eighth reserved for after-input')
                self.require_sql_reserve(); time.sleep(.25); self.require_sql_reserve()

    def require_sql_reserve(self):
        base.require(self.remaining() > base.RELEASE + base.GRACE and
                     time.monotonic() < self.launched + 90, 'Original SQL/observer/release reserve unavailable')
        self.resources()

    def one_gesture(self, index, raw, value):
        base.require(self.db is not None and self.db.zero is not None,
                     'Actual stored-zero baseline must precede gesture preparation')
        return super().one_gesture(index, raw, value)

    def sql_call(self, label, read, observed_file):
        before = len(self.db.records)
        error = None
        self.require_sql_reserve()
        deadline = min(time.monotonic() + self.helper.MAX_SECONDS - self.db.spent_seconds,
                       self.started + base.TOTAL - base.RELEASE - base.GRACE, self.launched + 90)
        original_sqlite = self.helper.sqlite3
        def boundary():
            self.resources()
            self.observation()  # Same fresh live original WK; no database or DOM mutation.
        guarded_sqlite = DeadlineSqlite(original_sqlite, self.helper, deadline, boundary)
        self.helper.sqlite3 = guarded_sqlite
        try:
            result = read()
            self.db_record(label, result, observed_file)
            return result
        except Exception as failure:
            error = type(failure).__name__ + ': ' + str(failure)
            self.receipt['separateReadonlyDatabaseSupplement']['refusal'] = error
            raise
        finally:
            self.helper.sqlite3 = original_sqlite
            if guarded_sqlite.interrupted_reason is not None:
                self.receipt['separateReadonlyDatabaseSupplement']['sqlInterruptedReason'] = guarded_sqlite.interrupted_reason
            if error is not None:
                # A completed bounded SQL snapshot may precede a phase predicate
                # rejection. Preserve it as rejected evidence, never as acceptance.
                for index, value in enumerate(self.db.records[before:], before + 1):
                    self.db_record(f'{label}-rejected-snapshot-{index}', value, observed_file)
                self.save()
            self.resources()

    def observe_persisted_candidate(self):
        base.require(self.db is not None and self.db.zero is not None and self.last_input is not None and
                     len(self.measurements) > 0, 'Actually observed zero and completed genuine input required')
        index = self.last_input['index']; measurement = self.measurements[-1]
        base.require(measurement['gestureIndex'] == index and
                     (measurement['rawCGFloatExact240'] or measurement['float32ArithmeticEquals240']),
                     'No same completed measured native240 candidate')
        test_path = Path(measurement['rawTests']['path']); base.regular(test_path)
        base.require(base.sha(test_path) == measurement['rawTests']['sha256'], 'Raw native tests changed')
        exact_leaf = exact_completed_leaf(json.loads(test_path.read_text()))
        summary_path = Path(measurement['rawSummary']['path']); base.regular(summary_path)
        base.require(base.sha(summary_path) == measurement['rawSummary']['sha256'], 'Raw native summary changed')
        info_path = base.RUN_ROOT / f'request-{index}.xcresult/Info.plist'; base.regular(info_path)
        base.require(base.sha(info_path) == measurement['completedInfoSHA256'], 'Completed native Info changed')
        request_path = base.RUN_ROOT / f'request-{index}.json'; base.regular(request_path)
        base.require(base.sha(request_path) == measurement['requestSHA256'], 'Completed native request changed')
        request = json.loads(request_path.read_text())
        completed = {'observationNonce': base.NONCE, 'webIdentity': str(UUID(self.identity)),
            'originalRawWebIdentity': self.identity, 'gestureIndex': index,
            'onlyTestIdentifier': base.SELECTOR, 'nativeTests': {'total': 1, 'passed': 1, 'failed': 0, 'skipped': 0},
            'programmaticScroll': False, 'inputEndedAtUnixSeconds': self.last_input['commandCompletedAtUnixSeconds'],
            'endTimeMeaning': 'actual successful native command completion; conservative original debounce lower bound',
            'beforeNativeKvoEventCount': request['beforeNativeKvoEventCount'], 'rawTestLeafIdentifier': exact_leaf,
            'rawTests': measurement['rawTests'], 'rawSummary': measurement['rawSummary'],
            'completedInfoSHA256': measurement['completedInfoSHA256'], 'requestSHA256': measurement['requestSHA256']}
        self.db_record('completed-genuine-input', completed)
        self.require_sql_reserve()
        while time.time() - completed['inputEndedAtUnixSeconds'] < 2:
            self.resources()
            base.require(self.remaining() > base.RELEASE + base.GRACE and time.monotonic() < self.launched + 90,
                         'Original debounce consumes release reserve')
            time.sleep(.2)
        fresh_raw, fresh = self.wait_observation(min(self.launched + 85, time.monotonic() + 5), request)
        geometry = fresh['samples'][-1]['geometry']
        base.require(geometry['positionPixels'] == 240 or geometry['sourceCallbackFloat32PositionPixels'] == 240,
                     'Native candidate changed during original debounce')
        fresh_file = super().keep_observation('db-candidate-after-original-debounce', fresh_raw)
        self.require_sql_reserve()
        result = self.sql_call('actual-persisted-position-after-input',
                               lambda: self.db.observe_after_genuine_input(fresh, completed), fresh_file)
        self.receipt['persistedPositionRead'] = True
        self.receipt['separateReadonlyDatabaseSupplement']['persistedTransitionObserved'] = result['persistedTransitionObserved']
        self.receipt['separateReadonlyDatabaseSupplement']['rawGeometryAndFloat32ProjectionRemainDistinct'] = True
        self.receipt['separateReadonlyDatabaseSupplement']['snapshotCount'] = self.db.attempts
        self.receipt['separateReadonlyDatabaseSupplement']['sqlSeconds'] = self.db.spent_seconds
        self.receipt['separateReadonlyDatabaseSupplement']['returnedRowBytes'] = self.db.returned_bytes
        after_raw, after = self.observation()
        after_geometry = after['samples'][-1]['geometry']
        base.require(after_geometry['positionPixels'] == 240 or after_geometry['sourceCallbackFloat32PositionPixels'] == 240,
                     'Actual native candidate changed during SQL readback')
        super().keep_observation('db-candidate-after-sql-readback', after_raw)
        self.receipt['separateReadonlyDatabaseSupplement']['nativeCandidateRemainedAfterSQL'] = True
        self.save()


def main():
    parser = argparse.ArgumentParser(); parser.add_argument('--execute', action='store_true')
    parser.add_argument('--allocation', type=Path); parser.add_argument('--allocation-sha256')
    parser.add_argument('--database-allocation', type=Path); parser.add_argument('--database-allocation-sha256')
    args = parser.parse_args(); plan, helper, physical = admission()
    if not args.execute:
        base.require(all(value is None for value in (args.allocation, args.allocation_sha256,
                     args.database_allocation, args.database_allocation_sha256)), 'Readonly mode takes no grants')
        print(json.dumps({'status': 'readonly-separate-db-wrapper-preparation-pass', 'databaseOpened': False,
                          'nativeExecuted': False, 'runRootCreated': False})); return 0
    base.require(all(value is not None for value in (args.allocation, args.allocation_sha256,
                 args.database_allocation, args.database_allocation_sha256)), 'Both separate Root allocations required')
    physical_grant = base.allocation(args.allocation, args.allocation_sha256, physical[0])
    db_grant = database_allocation(args.database_allocation, args.database_allocation_sha256, plan,
                                   args.allocation, args.allocation_sha256)
    return DatabaseExecutor(physical, physical_grant, plan, helper, db_grant,
                            args.database_allocation, args.database_allocation_sha256, args.allocation).run()


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (ValueError, OSError, KeyError, json.JSONDecodeError, UnicodeDecodeError) as error:
        print(json.dumps({'status': 'refused-before-or-outside-native', 'reason': str(error)})); raise SystemExit(1)
