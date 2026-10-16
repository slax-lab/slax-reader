#!/usr/bin/env python3
"""Exercise compiler-monitor races with real files/pipes, never native tools."""
import importlib.util
import json
import os
from pathlib import Path
import plistlib
import signal
import subprocess
import tempfile
import time
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('source_scroll_build_monitor', HERE / 'build-native-scroll.py')
executor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(executor)


class PipeProcess:
    """Real selector-readable output, with all process creation/kill mocked."""
    pid = 424242

    def __init__(self):
        self.returncode = None
        self.stdout = self.pipe(b'partial compiler stdout\n')
        self.stderr = self.pipe(b'partial compiler stderr\n')

    @staticmethod
    def pipe(data):
        read, write = os.pipe()
        os.write(write, data)
        os.close(write)
        return os.fdopen(read, 'rb', buffering=0)

    def poll(self):
        return self.returncode

    def wait(self, timeout):
        if self.returncode is None:
            raise AssertionError('The executor must kill only its created group before waiting')
        return self.returncode

    def kill_group(self, pid, requested_signal):
        if pid != self.pid or requested_signal != signal.SIGKILL:
            raise AssertionError('Unexpected process group or signal')
        self.returncode = -signal.SIGKILL


class MonitorTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='slax-source-monitor-host-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.budget = dict(json.loads((executor.HERE / 'inputs.json').read_bytes())['budget'])
        # The tests do not allocate native products. Exercise the actual caps
        # separately while avoiding dependence on this machine's free space.
        self.budget['minimumFreeDuringBytes'] = 0

    def test_native_atomic_rename_is_tolerated_only_during_monitoring_and_recounted(self):
        old = self.root / 'swift-module-cache/owned/module.pcm.tmp'
        old.parent.mkdir(parents=True)
        old.write_bytes(b'A' * (1024 * 1024))
        renamed = old.with_suffix('')
        original_lstat = Path.lstat

        def rename_during_lstat(path):
            if path == old:
                old.rename(renamed)
                raise FileNotFoundError(2, 'Compiler atomically renamed this temporary file', str(path))
            return original_lstat(path)

        with patch.object(Path, 'lstat', rename_during_lstat):
            self.assertIsNone(executor.resource_status(self.root, self.budget, allow_vanished_generated=True))
        observation = {}
        self.assertIsNone(executor.resource_status(self.root, self.budget, observation))
        self.assertGreaterEqual(observation['maximumAllocatedObservedBytes'], renamed.stat().st_blocks * 512)
        self.budget['maximumNewAllocatedBytes'] = 1
        self.assertEqual(executor.resource_status(self.root, self.budget), 'new-artifact-cap')

    def test_missing_native_entry_in_final_scan_is_not_silently_ignored(self):
        path = self.root / 'derived-data/native.tmp'
        path.parent.mkdir()
        path.write_bytes(b'A')
        original_lstat = Path.lstat

        def vanished(candidate):
            if candidate == path:
                raise FileNotFoundError(2, 'Missing generated entry', str(candidate))
            return original_lstat(candidate)

        with patch.object(Path, 'lstat', vanished):
            with self.assertRaises(FileNotFoundError):
                executor.resource_status(self.root, self.budget)

    def test_missing_copied_input_is_rejected_even_during_monitoring(self):
        path = self.root / 'shell/main.swift'
        path.parent.mkdir()
        path.write_bytes(b'public source input')
        original_lstat = Path.lstat

        def vanished(candidate):
            if candidate == path:
                raise FileNotFoundError(2, 'Missing copied input', str(candidate))
            return original_lstat(candidate)

        with patch.object(Path, 'lstat', vanished):
            with self.assertRaises(FileNotFoundError):
                executor.resource_status(self.root, self.budget, allow_vanished_generated=True)

    def test_other_native_stat_exception_remains_rejected(self):
        path = self.root / 'swift-module-cache/native.tmp'
        path.parent.mkdir()
        path.write_bytes(b'A')
        original_lstat = Path.lstat

        def denied(candidate):
            if candidate == path:
                raise PermissionError('Native generated entry cannot be inspected')
            return original_lstat(candidate)

        with patch.object(Path, 'lstat', denied):
            with self.assertRaises(PermissionError):
                executor.resource_status(self.root, self.budget, allow_vanished_generated=True)

    def test_unexpected_monitor_exception_preserves_both_pipes_and_kills_only_owned_group(self):
        process = PipeProcess()
        calls = 0

        def monitor():
            nonlocal calls
            calls += 1
            if calls >= 3:
                raise PermissionError('The monitor cannot continue')
            return None

        with patch.object(executor.subprocess, 'Popen', return_value=process) as popen, \
                patch.object(executor.os, 'killpg', side_effect=process.kill_group) as kill:
            code, stdout, stderr, stopped = executor.bounded_command(
                ['/public/mock-native-tool'], {}, self.root, 1, 262144, monitor)
        self.assertEqual(code, -signal.SIGKILL)
        self.assertEqual(stdout, b'partial compiler stdout\n')
        self.assertEqual(stderr, b'partial compiler stderr\n')
        self.assertEqual(stopped, 'monitor-error:PermissionError')
        self.assertTrue(popen.call_args.kwargs['start_new_session'])
        self.assertIs(popen.call_args.kwargs['stdin'], subprocess.DEVNULL)
        kill.assert_called_once_with(process.pid, signal.SIGKILL)

    def test_execute_archives_failed_command_output_and_receipt_before_refusing(self):
        info = self.root / 'public-info.plist'
        info.write_bytes(plistlib.dumps({'CFBundleIdentifier': 'app.slax.reader.sourcefixture'}))
        output = self.root / 'new-output'
        manifest = {
            'budget': self.budget, 'developerDirectory': '/public/Developer', 'sdkPath': '/public/sdk',
            'sourceRoot': '/public/source-j',
            'inputs': [{'path': str(info), 'destination': 'SlaxSourceFixtureApp.app/Info.plist',
                'sha256': executor.digest(info)}],
            'tools': [{'id': name, 'invocationPath': '/public/' + name} for name in ('swiftc', 'codesign', 'xcodebuild')],
        }
        grant = {'nonce': 'host-monitor-regression', 'expiresAt': int(time.time() * 1000) + 10000}
        process = PipeProcess()
        active_calls = 0

        def monitor(_output, _budget, _observation=None, allow_vanished_generated=False):
            nonlocal active_calls
            if allow_vanished_generated:
                active_calls += 1
                if active_calls >= 3:
                    raise PermissionError('Unexpected live monitor failure')
            return None

        with patch.object(executor, 'checked_inputs', return_value=manifest), \
                patch.object(executor, 'owned_allocation', return_value=grant), \
                patch.object(executor, 'resource_status', side_effect=monitor), \
                patch.object(executor.subprocess, 'Popen', return_value=process), \
                patch.object(executor.os, 'killpg', side_effect=process.kill_group):
            with self.assertRaisesRegex(ValueError, 'Native command failed/stopped'):
                executor.execute(output, self.root / 'unused-mock-allocation')
        failure = json.loads((output / 'failure.json').read_bytes())
        self.assertEqual(failure['status'], 'failed-build-preserved-no-retry')
        self.assertEqual(len(failure['commands']), 1)
        self.assertEqual(failure['commands'][0]['stopped'], 'monitor-error:PermissionError')
        self.assertEqual((output / 'compile-source-swift-shell.stdout').read_bytes(), b'partial compiler stdout\n')
        self.assertEqual((output / 'compile-source-swift-shell.stderr').read_bytes(), b'partial compiler stderr\n')
        self.assertFalse((output / 'report.json').exists())

    def test_successful_child_still_requires_strict_stopped_process_accounting(self):
        info = self.root / 'public-info.plist'
        info.write_bytes(plistlib.dumps({'CFBundleIdentifier': 'app.slax.reader.sourcefixture'}))
        output = self.root / 'strict-final-output'
        manifest = {
            'budget': self.budget, 'developerDirectory': '/public/Developer', 'sdkPath': '/public/sdk',
            'sourceRoot': '/public/source-j',
            'inputs': [{'path': str(info), 'destination': 'SlaxSourceFixtureApp.app/Info.plist',
                'sha256': executor.digest(info)}],
            'tools': [{'id': name, 'invocationPath': '/public/' + name} for name in ('swiftc', 'codesign', 'xcodebuild')],
        }
        grant = {'nonce': 'host-final-accounting', 'expiresAt': int(time.time() * 1000) + 10000}
        finished = False

        def successful_command(*_args):
            nonlocal finished
            finished = True
            return 0, b'finished stdout', b'finished stderr', None

        def monitor(_output, _budget, _observation=None, allow_vanished_generated=False):
            if finished and not allow_vanished_generated:
                raise FileNotFoundError('Final generated entry disappeared after the child stopped')
            return None

        with patch.object(executor, 'checked_inputs', return_value=manifest), \
                patch.object(executor, 'owned_allocation', return_value=grant), \
                patch.object(executor, 'resource_status', side_effect=monitor), \
                patch.object(executor, 'bounded_command', side_effect=successful_command), \
                patch.object(executor.subprocess, 'Popen', side_effect=AssertionError('No subprocess permitted')):
            with self.assertRaises(FileNotFoundError):
                executor.execute(output, self.root / 'unused-mock-allocation')
        failure = json.loads((output / 'failure.json').read_bytes())
        self.assertEqual(failure['status'], 'failed-build-preserved-no-retry')
        self.assertEqual(failure['commands'][0]['exitCode'], 0)
        self.assertIsNone(failure['commands'][0]['stopped'])
        self.assertTrue(failure['error'].startswith('FileNotFoundError:'))
        self.assertEqual((output / 'compile-source-swift-shell.stdout').read_bytes(), b'finished stdout')
        self.assertFalse((output / 'report.json').exists())


if __name__ == '__main__':
    unittest.main(verbosity=2)
