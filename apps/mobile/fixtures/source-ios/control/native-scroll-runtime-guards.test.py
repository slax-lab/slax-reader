#!/usr/bin/env python3
"""Synthetic host files and mocked child processes only; no native tools/devices."""
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import plistlib
import signal
import struct
import tempfile
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    value = importlib.util.module_from_spec(spec); spec.loader.exec_module(value); return value
module = load('source_native_runtime', HERE / 'run-native-scroll.py')
prepare = load('unchanged_source_prepare', HERE / 'prepare-native-scroll.py')


def observation(position=0, now=100, count=0):
    offset, inset = position / 3 - 384.6666564941406, 384.6666564941406
    def f32(v): return struct.unpack('<f', struct.pack('<f', v))[0]
    geometry = {'offsetYPoints': offset, 'topInsetPoints': inset, 'contentWidthPoints': 402,
                'contentHeightPoints': 2000, 'viewportWidthPoints': 402, 'viewportHeightPoints': 874,
                'positionPixels': max(0, offset + inset) * 3,
                'sourceCallbackFloat32Density': 3,
                'sourceCallbackFloat32PositionPixels': max(f32(f32(f32(offset) + f32(inset)) * f32(3)), 0),
                'frameInWindow': {'x': 0, 'y': 0, 'width': 402, 'height': 874},
                'windowAttached': True, 'loading': False, 'dragging': False, 'decelerating': False}
    return {'kind': 'original-source-native-reader-observation', 'controlledFixture': True, 'fixtureVersion': 1,
            'bundleIdentifier': module.SOURCE_ID, 'state': 'observing', 'observationNonce': module.NONCE,
            'webIdentity': '23195bfe-e6e4-48c0-b7a4-40f637204eec', 'scale': 3, 'appearance': 'light',
            'preferredContentSizeCategory': 'UICTContentSizeCategoryL', 'safeTopPoints': 62, 'safeBottomPoints': 34,
            'sourcePreparedStatus': {'controlledFixture': True, 'fixtureVersion': 1, 'state': 'prepared',
                                    'scenario': 'reader-mixed', 'route': 'Reader', 'locale': 'en',
                                    'selectedActionIndex': -1, 'fixtureInputSha256': prepare.FIXTURE_SHA,
                                    'sourceManifestSha256': prepare.SOURCE_SHA},
            'samples': [{'elapsedSeconds': i + 1, 'observedAtUnixSeconds': now - .4 + i * .2,
                         'bodyAndBridgeReady': True, 'geometry': copy.deepcopy(geometry)} for i in range(3)],
            'nativeKvoEventCount': count,
            'nativeKvoEvents': [{'kind': 'native-contentOffset-KVO', 'sequence': i + 1,
                                'geometry': copy.deepcopy(geometry)} for i in range(count)]}


class Guards(unittest.TestCase):
    def test_original_preparer_and_separate_float_precision_no_callback_acceptance(self):
        before = observation(); actual = module.observed_value(json.dumps(before).encode(), prepare, module.NONCE, now=100)
        request = prepare.checked_request(actual, 1, 100)
        self.assertEqual(request['startPoints'], {'x': 360, 'y': 600})
        self.assertEqual(request['endPoints'], {'x': 360, 'y': 520})
        after = observation(240, 101, 1)
        actual = module.observed_value(json.dumps(after).encode(), prepare, module.NONCE, before['webIdentity'], 101)
        measured = module.measured_post_input(actual, request)
        self.assertTrue(measured['rawCGFloatExact240']); self.assertTrue(measured['float32ArithmeticEquals240'])
        self.assertFalse(measured['actualKotlinCallbackObserved']); self.assertFalse(measured['persistedPositionRead']); self.assertFalse(measured['accepted'])
        # The raw CGFloat projection remains distinct when Float32 quantizes it.
        after = observation(239.99997, 101, 1)
        actual = module.observed_value(json.dumps(after).encode(), prepare, module.NONCE, before['webIdentity'], 101)
        measured = module.measured_post_input(actual, request)
        self.assertFalse(measured['rawCGFloatExact240']); self.assertTrue(measured['float32ArithmeticEquals240'])
        self.assertFalse(measured['accepted'])

    def test_stale_foreign_nonce_identity_wrong_precision_and_malformed_drop(self):
        for changed in [dict(observation(), observationNonce='b054577c-dc4c-4c04-925c-83382fc5e7cd'),
                        dict(observation(), webIdentity='f92d03b6-e5f7-4bfc-b4d0-87e2a71a4201'),
                        dict(observation(), state='observation-expired'), observation(now=95)]:
            with self.subTest(), self.assertRaises(ValueError):
                module.observed_value(json.dumps(changed).encode(), prepare, module.NONCE, observation()['webIdentity'], 100)
        for field, value in [('sourceCallbackFloat32PositionPixels', 240), ('sourceCallbackFloat32Density', True), ('offsetYPoints', True)]:
            changed = observation()
            for sample in changed['samples']: sample['geometry'][field] = value
            with self.subTest(field=field), self.assertRaises(ValueError):
                module.observed_value(json.dumps(changed).encode(), prepare, module.NONCE, now=100)
        with self.assertRaises(ValueError): module.observed_value(b'x' * (module.OBSERVER_CAP + 1), prepare, module.NONCE, now=100)

    def test_no_new_kvo_no_movement_and_old_post_samples_refused(self):
        request = prepare.checked_request(observation(), 1, 100)
        for after in [observation(240, 101, 0), observation(0, 101, 1), observation(240, 99, 1)]:
            with self.subTest(), self.assertRaises(ValueError): module.measured_post_input(after, request)

    def test_exact_selector_device_count_and_no_compile_or_setter(self):
        for index in range(1, 4): module.exact_command(module.test_command(index))
        for index in [0, 4, True]:
            with self.assertRaises(ValueError): module.test_command(index)
        for argv in [[module.XCODE, 'build'], [module.XCRUN, 'simctl', 'boot', module.DATA_DEVICE],
                     [module.XCRUN, 'simctl', 'get_app_container', module.DEVICE, 'app.slax.reader', 'data'],
                     [module.XCRUN, 'simctl', 'erase', module.DEVICE],
                     module.test_command(1)[:-3] + ['-only-testing:SourceFixtureControl/SourceFixtureControl/testCancelObservedSlaxOpenDialogAndCapture']]:
            with self.subTest(argv=argv), self.assertRaises(ValueError): module.exact_command(argv)

    def test_v1_plist_only_testroot_and_one_request_env_added(self):
        original = {'SourceFixtureControl': {'EnvironmentVariables': {'TERM': 'dumb'},
                    'TestBundlePath': '__TESTHOST__/PlugIns/source.xctest',
                    'TestHostPath': '__TESTROOT__/Debug/source.app',
                    'TestingEnvironmentVariables': {'LIB': '__TESTROOT__/Debug:__PLATFORMS__/framework'}},
                    '__xctestrun_metadata__': {'FormatVersion': 1}}
        old = copy.deepcopy(original); result = module.copy_request_plist(original, Path('/private/tmp/owned/Products'), {'gestureIndex': 1})
        self.assertEqual(original, old)
        self.assertEqual(result['SourceFixtureControl']['TestHostPath'], '/private/tmp/owned/Products/Debug/source.app')
        self.assertEqual(result['SourceFixtureControl']['TestBundlePath'], old['SourceFixtureControl']['TestBundlePath'])
        self.assertIn('__PLATFORMS__', result['SourceFixtureControl']['TestingEnvironmentVariables']['LIB'])
        self.assertEqual(json.loads(result['SourceFixtureControl']['EnvironmentVariables']['SLAX_SOURCE_NATIVE_SCROLL_REQUEST']), {'gestureIndex': 1})
        with self.assertRaises(ValueError): module.copy_request_plist(original, Path('/private/tmp/owned/Products'), {'large': 'x' * module.REQUEST_CAP})

    def test_global_floor_full_installed_roots_sparse_apparent_cap_and_no_main_subtree(self):
        zero = {'logicalBytes': 0, 'allocatedBytes': 0}
        module.resource_guard(zero, zero, module.PRE_FREE, 0, True)
        for own, installed, free, logs in [(zero, {'logicalBytes': module.CAP, 'allocatedBytes': 0}, module.PRE_FREE, 0),
                                          (zero, zero, module.FLOOR - 1, 0), (zero, zero, module.PRE_FREE, module.LOG_CAP + 1)]:
            with self.subTest(), self.assertRaises(ValueError): module.resource_guard(own, installed, free, logs)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve(); a = root / 'source'; a.mkdir(); (a / 'source-data').write_bytes(b'ab')
            b = root / 'helper'; b.mkdir(); (b / 'helper-data').write_bytes(b'abc')
            main = root / 'main'; main.mkdir(); (main / 'do-not-traverse').symlink_to('/not-read')
            records = {str(a): module.SOURCE_ID, str(b): module.SOURCE_ID + '.controlhost', str(main): 'app.slax.reader'}
            with patch.object(module, 'registry', return_value=records):
                result = module.owned_containers(records)
            self.assertEqual(result['logicalBytes'], 5); self.assertEqual({e['path'] for e in result['containers']}, {str(a), str(b)})
            p = a / 'sparse'
            with p.open('wb') as f: f.truncate(module.CAP)
            with self.assertRaises(ValueError): module.resource_guard(module.tree(a), zero, module.PRE_FREE, 0)

    def test_operator_booted_state_metadata_only_owned88_refuses(self):
        with tempfile.TemporaryDirectory() as directory:
            p = Path(directory).resolve() / 'devices.json'
            data = [{'udid': module.DEVICE, 'name': 'owned', 'state': 'Shutdown'}, {'udid': module.DATA_DEVICE, 'state': 'Shutdown'},
                    {'udid': 'operator', 'name': 'operator-simulator', 'state': 'Booted'}]
            p.write_text(json.dumps({'devices': {'runtime': data}}))
            executor = module.Executor.__new__(module.Executor); executor.plan = {'deviceName': 'owned'}; executor.receipt = {}
            executor.device_list(p, True)
            self.assertEqual(executor.receipt['readonlyOtherSimulatorStates'], [data[2]])
            data[1]['state'] = 'Booted'; p.write_text(json.dumps({'devices': {'runtime': data}}))
            with self.assertRaises(ValueError): executor.device_list(p, True)

    def test_monitor_failure_preserves_logs_and_stops_only_owned_group(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve(); (root / 'logs').mkdir()
            executor = module.Executor.__new__(module.Executor); executor.commands = []; executor.save = lambda: None
            executor.remaining = lambda: 100
            calls = iter([None, ValueError('synthetic allocation breach')])
            def resources():
                value = next(calls)
                if value: raise value
            executor.resources = resources
            class Process:
                pid = 888888; returncode = None
                def poll(self): return self.returncode
                def wait(self, timeout=None): self.returncode = -signal.SIGTERM
            process = Process(); sent = []
            with patch.object(module, 'RUN_ROOT', root), patch.object(module.subprocess, 'Popen', return_value=process), \
                 patch.object(module.os, 'getpgid', return_value=process.pid), patch.object(module.os, 'killpg', side_effect=lambda p,s: sent.append((p,s))):
                with self.assertRaisesRegex(ValueError, 'allocation breach'):
                    executor.command([module.XCRUN, 'simctl', 'list', 'devices', '--json'], 10)
            self.assertEqual(sent, [(888888, signal.SIGTERM)])
            self.assertEqual(executor.commands[0]['exitCode'], -signal.SIGTERM)
            self.assertEqual(executor.commands[0]['stdoutSHA256'], hashlib.sha256(b'').hexdigest())

    def test_finite_live_observer_and_global_release_reservation(self):
        module.live_window_admission(30, 40, 69)
        for elapsed, since_launch, remaining in [(30.00001, 40, 100), (True, 40, 100), (float('nan'), 40, 100),
                                                  (20, 90, 100), (20, 40, 68.9)]:
            with self.subTest(), self.assertRaises(ValueError): module.live_window_admission(elapsed, since_launch, remaining)

    def test_actual_manifest_order_is_canonicalized_without_ignoring_metadata(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            for i in range(52):
                p = root / f'file-{i:02d}'; p.write_text(str(i)); p.chmod(0o755 if i == 0 else 0o644)
            expected = [dict(e, kind='regular') for e in module.product_records(root)]
            with patch.object(module, 'PRODUCT_ROOT', root):
                actual = module.verify_products(list(reversed(expected)))
                self.assertEqual(actual, module.product_records(root))
                changed = copy.deepcopy(expected); changed[0]['mode'] = 0o644
                with self.assertRaises(ValueError): module.verify_products(changed)
                (root / 'unexpected').write_text('extra')
                with self.assertRaises(ValueError): module.verify_products(expected)

    def test_fresh_allocation_binds_attempt_and_original_no_setter_scope(self):
        with tempfile.TemporaryDirectory() as directory:
            p = Path(directory).resolve() / 'grant.json'
            plan = {'allocationPath': str(p)}
            grant = {'kind': 'root-one-source-physical-native-scroll-allocation', 'version': 1,
                     'executorSHA256': module.sha(HERE / 'run-native-scroll.py'), 'planSHA256': 'plan-sha',
                     'runRoot': str(module.RUN_ROOT), 'device': module.DEVICE, 'observationNonce': module.NONCE,
                     'onlyTestIdentifier': module.SELECTOR, 'attempts': 1, 'maximumGestureIndices': 3,
                     'exclusiveDeviceLoan': True, 'allOtherNativeLoansReleased': True, 'expiresAtUnixSeconds': 101}
            real = module.sha
            with patch.object(module, 'sha', side_effect=lambda path: 'plan-sha' if path == module.PLAN else real(path)), \
                 patch.object(module.time, 'time', return_value=100):
                p.write_text(json.dumps(grant)); module.allocation(p, real(p), plan)
                for key, value in [('attempts', 2), ('maximumGestureIndices', 4), ('expiresAtUnixSeconds', 99),
                                   ('observationNonce', 'other'), ('executorSHA256', 'old')]:
                    p.write_text(json.dumps({**grant, key: value}))
                    with self.subTest(), self.assertRaises(ValueError): module.allocation(p, real(p), plan)


if __name__ == '__main__': unittest.main(verbosity=2)
