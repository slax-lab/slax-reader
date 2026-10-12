#!/usr/bin/env python3
"""Host-only tests with synthetic files and mocked processes; no simulator/tool calls."""
import importlib.util
import json
from pathlib import Path
import plistlib
import signal
import tempfile
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('bitmap_executor', HERE / 'run-bitmap-only.py')
module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)


class Guards(unittest.TestCase):
    def test_exact_command_rejects_live_drag_device_and_build(self):
        module.exact_command(module.test_command())
        for argv in [module.test_command()[:-3] + ['-only-testing:CrossParagraphControl/ReaderCrossParagraphControl/testNativeEndHandleDragFromGenuineAlphaTowardSecondParagraph'],
                     [module.XCRUN, 'simctl', 'boot', 'another-device'], [module.XCODE, 'build'],
                     [module.XCRUN, 'simctl', 'launch', module.DEVICE, 'app.slax.reader.uifixture']]:
            with self.subTest(argv=argv), self.assertRaises(ValueError): module.exact_command(argv)

    def test_resource_guard_counts_installed_helper_and_sparse_apparent_bytes(self):
        zero = {'logicalBytes': 0, 'allocatedBytes': 0}
        module.resource_guard(zero, zero, module.PRE_FREE, 0, True)
        for own, installed, free, logs in [
            ({'logicalBytes': 80 << 20, 'allocatedBytes': 80 << 20}, {'logicalBytes': 48 << 20, 'allocatedBytes': 1}, module.PRE_FREE, 0),
            (zero, zero, module.FLOOR - 1, 0), (zero, zero, module.PRE_FREE, module.LOG_CAP + 1)]:
            with self.subTest(), self.assertRaises(ValueError): module.resource_guard(own, installed, free, logs)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve(); sparse = root / 'large-sparse-file'
            with sparse.open('wb') as output: output.truncate(module.CAP)
            count = module.tree(root)
            self.assertEqual(count['logicalBytes'], module.CAP)
            with self.assertRaises(ValueError): module.resource_guard(count, zero, module.PRE_FREE, 0)

    def test_new_installed_bundle_and_data_are_counted_unknown_identity_refused(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            def container(kind, name, identity, content):
                path = root / 'data/Containers' / kind / 'Application' / name; path.mkdir(parents=True)
                (path / '.com.apple.mobile_container_manager.metadata.plist').write_bytes(plistlib.dumps({'MCMMetadataIdentifier': identity}))
                (path / 'synthetic-public-payload').write_bytes(content); return path
            container('Data', 'existing', 'app.slax.reader.uifixture', b'unchanged')
            baseline = module.container_candidates(root)
            bundle = container('Bundle', 'new-bundle', sorted(module.IDENTITIES)[0], b'a' * 100)
            data = container('Data', 'new-data', sorted(module.IDENTITIES)[1], b'b' * 200)
            count = module.installed_accounting(root, baseline)
            self.assertEqual({e['path'] for e in count['containers']}, {str(bundle), str(data)})
            self.assertGreaterEqual(count['logicalBytes'], 300)
            container('Data', 'unknown', 'app.slax.reader', b'never-read-as-content')
            with self.assertRaises(ValueError): module.installed_accounting(root, baseline)

    def test_partial_installer_is_counted_then_requires_identity(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve(); path = root / 'data/Containers/Bundle/Application/new'; path.mkdir(parents=True)
            (path / 'payload').write_bytes(b'abc')
            count = module.installed_accounting(root, {}, True)
            self.assertEqual(count['logicalBytes'], 3); self.assertEqual(count['pendingIdentities'], [str(path)])
            with self.assertRaises(ValueError): module.installed_accounting(root, {}, False)

    def test_source_closed_copy_preserves_53_modes_bytes_and_plist(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve(); source = root / 'source'; source.mkdir(); run = root / 'run'; run.mkdir()
            for i in range(53):
                p = source / f'file-{i:02d}'; p.write_bytes(str(i).encode()); p.chmod(0o755 if i == 0 else 0o644)
            entries = module.product_records(source)
            module.verify_products(source, [dict(e, actualMachOHeader={'architecture': 'arm64'}) if index == 0 else e for index, e in enumerate(entries)])
            executor = module.Executor.__new__(module.Executor); executor.source = source; executor.entries = entries
            executor.remaining = lambda: 100; executor.resources = lambda *args: None
            with patch.object(module, 'RUN_ROOT', run): executor.copy_products()
            self.assertEqual(module.product_records(source), entries)
            self.assertEqual(module.product_records(run / 'Products'), entries)
            (source / 'extra').write_bytes(b'changed')
            with self.assertRaises(ValueError): module.verify_products(source, entries)

    def test_symlink_and_parent_traversal_refuse(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve(); (root / 'target').write_bytes(b'x'); (root / 'link').symlink_to(root / 'target')
            with self.assertRaises(ValueError): module.tree(root)
        for relative in ('../target', '/target'):
            with self.assertRaises(ValueError): module.safe_relative(relative)

    def test_allocation_requires_fresh_scope_and_final_executor_hash(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory).resolve() / 'allocation.json'; policy = {'allocationPath': str(path)}
            grant = {'kind': 'root-one-cross-bitmap-only-native-allocation', 'version': 1,
                     'executorSHA256': module.sha(HERE / 'run-bitmap-only.py'), 'runtimePolicySHA256': 'policy-hash',
                     'basePlanSHA256': module.BASE_SHA, 'runRoot': str(module.RUN_ROOT), 'device': module.DEVICE,
                     'onlyTestIdentifier': module.SELECTOR, 'attempts': 1, 'noTargetInput': True,
                     'exclusiveDeviceLoan': True, 'allOtherNativeLoansReleased': True, 'expiresAtUnixSeconds': 200}
            real_sha = module.sha
            def digest(p): return 'policy-hash' if p == module.POLICY else real_sha(p)
            with patch.object(module, 'sha', side_effect=digest), patch.object(module.time, 'time', return_value=100):
                path.write_text(json.dumps(grant)); module.allocation(path, real_sha(path), policy)
                for key, value in [('onlyTestIdentifier', 'native-drag'), ('attempts', 2), ('expiresAtUnixSeconds', 99), ('executorSHA256', 'stale')]:
                    with self.subTest(key=key):
                        changed = {**grant, key: value}; path.write_text(json.dumps(changed))
                        with self.assertRaises(ValueError): module.allocation(path, real_sha(path), policy)

    def test_monitor_failure_kills_only_owned_group_and_preserves_raw_record(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve(); (root / 'logs').mkdir()
            executor = module.Executor.__new__(module.Executor); executor.commands = []; executor.log_bytes = 0
            executor.save = lambda: None; executor.remaining = lambda: 100
            resource_calls = iter([None, ValueError('synthetic floor breach')])
            def resources():
                next_value = next(resource_calls)
                if next_value is not None: raise next_value
            executor.resources = resources
            class Process:
                pid = 777777; returncode = None
                def poll(self): return self.returncode
                def wait(self, timeout=None): self.returncode = -signal.SIGTERM; return self.returncode
            process = Process(); sent = []
            with patch.object(module, 'RUN_ROOT', root), patch.object(module.subprocess, 'Popen', return_value=process), \
                 patch.object(module.os, 'getpgid', return_value=process.pid), patch.object(module.os, 'killpg', side_effect=lambda p, s: sent.append((p, s))):
                with self.assertRaisesRegex(ValueError, 'floor breach'):
                    executor.command([module.XCRUN, 'simctl', 'list', 'devices', '--json'], 5)
            self.assertEqual(sent, [(777777, signal.SIGTERM)])
            self.assertEqual(len(executor.commands), 1)
            self.assertIn('synthetic floor breach', executor.commands[0]['stopped'])
            self.assertEqual(executor.commands[0]['exitCode'], -signal.SIGTERM)
            self.assertEqual(executor.commands[0]['stdoutSHA256'], module.sha(root / 'logs/00.stdout'))

    def test_failed_boot_readiness_has_no_test_retry_and_releases_only_helpers(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            executor = module.Executor.__new__(module.Executor); executor.boot_issued = False; executor.receipt = {}; executor.entries = []; executor.source = root
            executor.started = module.time.monotonic(); executor.copy_products = lambda: None; executor.save = lambda: None
            calls = []; output = root / 'list.json'; output.write_text('{}')
            def command(argv, seconds, release=False):
                module.exact_command(argv); calls.append((argv, release))
                if 'bootstatus' in argv: raise ValueError('synthetic boot failure')
                return output
            executor.command = command; executor.check_device_list = lambda p, shutdown: None
            with patch.object(module, 'verify_products'), patch.object(module, 'verify_stage'):
                self.assertEqual(executor.run(), 1)
            self.assertFalse(any(argv[0] == module.XCODE for argv, _ in calls))
            terminated = {argv[-1] for argv, _ in calls if 'terminate' in argv}
            self.assertEqual(terminated, module.IDENTITIES)
            self.assertEqual(sum('shutdown' in argv for argv, _ in calls), 1)
            self.assertFalse(any('launch' in argv or 'erase' in argv or 'uninstall' in argv for argv, _ in calls))


if __name__ == '__main__': unittest.main(verbosity=2)
