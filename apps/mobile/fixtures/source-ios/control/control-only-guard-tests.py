#!/usr/bin/env python3
"""Host-only control-build guards; never invoke compiler, device or signing."""
import ast
import importlib.util
import json
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch
import uuid

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('source_control_only_guards', HERE / 'build-control-only.py')
executor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(executor)


class ControlOnlyGuards(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='host-control-guards-', dir=executor.HERE)
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.basis = json.loads((executor.HERE / 'input-basis.json').read_bytes())
        self.budget = dict(self.basis['budget'])
        self.budget['minimumFreeDuringBytes'] = 0
        self.exceptions = self.basis['sparseExceptions']

    def sparse(self, relative, size):
        path = self.root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open('wb') as handle:
            handle.seek(size - 1)
            handle.write(b'A')
        return path

    def test_exact_three_known_sparse_caches_count_all_actual_blocks(self):
        for relative, size in self.exceptions.items():
            path = self.sparse(relative, size)
            self.assertTrue(executor.exact_sparse_cache(path, self.root, path.lstat(), self.exceptions))
        self.assertIsNone(executor.resource_status(self.root, self.budget, self.exceptions))
        self.budget['maximumNewAllocatedBytes'] = 1
        self.assertEqual(executor.resource_status(self.root, self.budget, self.exceptions), 'new-artifact-cap')

    def test_wrong_sparse_name_path_or_apparent_size_refuses(self):
        original = next(iter(self.exceptions))
        for relative, size in [(original + '.other', self.exceptions[original]),
                (original.replace('/v1.1/', '/v1.2/'), self.exceptions[original]),
                (original, self.exceptions[original] + 1)]:
            with self.subTest(relative=relative, size=size):
                path = self.sparse(relative, size)
                self.assertEqual(executor.resource_status(self.root, self.budget, self.exceptions), 'unexpected-large-owned-file')
                path.unlink()

    def test_same_sparse_name_cannot_hide_normal_nonsparse_file_or_symlink(self):
        relative, size = next(iter(self.exceptions.items()))
        path = self.sparse(relative, size)
        status = path.lstat()
        class FullAllocation:
            st_mode = status.st_mode
            st_size = size
            st_blocks = size // 512
        self.assertFalse(executor.exact_sparse_cache(path, self.root, FullAllocation(), self.exceptions))
        path.unlink()
        path.symlink_to('/usr/bin')
        self.assertEqual(executor.resource_status(self.root, self.budget, self.exceptions), 'external-generated-symlink')

    def test_sparse_cache_records_never_read_virtual_gigabytes(self):
        relative, size = next(iter(self.exceptions.items()))
        self.sparse(relative, size)
        with patch.object(executor.core, 'digest', side_effect=AssertionError('Do not hash rebuildable sparse contents')):
            records = executor.product_records(self.root, self.exceptions, lambda: None)
        record = records[relative]
        self.assertFalse(record['contentHashed'])
        self.assertEqual(record['bytes'], size)
        self.assertLess(record['allocatedBytes'], size)

    def test_final_native_generated_entry_loss_is_strict(self):
        path = self.root / 'derived-data/module.pcm.tmp'
        path.parent.mkdir()
        path.write_bytes(b'A')
        original_lstat = Path.lstat
        def vanished(candidate):
            if candidate == path:
                raise FileNotFoundError('Atomic native generated rename')
            return original_lstat(candidate)
        with patch.object(Path, 'lstat', vanished):
            self.assertIsNone(executor.resource_status(self.root, self.budget, self.exceptions, allow_vanished_generated=True))
            with self.assertRaises(FileNotFoundError):
                executor.resource_status(self.root, self.budget, self.exceptions)

    def test_native_product_logical_cap_has_no_sparse_cache_exception(self):
        path = self.root / 'derived-data/Build/Products/large-control'
        path.parent.mkdir(parents=True)
        path.write_bytes(b'ABC')
        self.budget['maximumNewProductLogicalBytes'] = 2
        self.assertEqual(executor.resource_status(self.root, self.budget, self.exceptions), 'unexpected-large-owned-file')

    def test_old_or_expanded_allocation_is_refused_before_native_call(self):
        output = Path('/private/tmp') / ('slax-source-native-scroll-control-' + str(uuid.uuid4()))
        now = int(time.time() * 1000)
        grant = {'kind': 'slax-root-source-native-scroll-control-build-allocation', 'version': 4,
            'outputRoot': str(output), 'basisSHA256': executor.BASIS_SHA256,
            'executorSHA256': executor.core.digest(Path(executor.__file__).resolve()),
            'previousExecutorSHA256': executor.PREVIOUS_EXECUTOR_SHA256, 'sourceRoot': self.basis['sourceRoot'],
            'sourceFailureSHA256': self.basis['sourceFailureSHA256'], 'rootScopeReportSHA256': self.basis['rootScopeReportSHA256'],
            'signedSourceExecutableSHA256': self.basis['sourceShellExecutableSHA256'],
            'rawFrameworkSHA256': self.basis['rawFrameworkSHA256'],
            'original113InputsSHA256': self.basis['originalInputsManifestSHA256'], 'fixtureInputSHA256': self.basis['fixtureInputSHA256'],
            'exclusiveNativeSlot': True, 'allowControlBuildOnly': True, 'allowSourceCopy': False,
            'allowSourceSwiftCompile': False, 'allowSignOrVerifyCommands': False, 'allowOldDerivedDataReuse': False,
            'allowKmpOrGradle': False, 'allowDeviceCommands': False, 'allowMetroCommands': False, 'allowCleanup': False,
            'nonce': str(uuid.uuid4()), 'requestedAt': now - 100, 'expiresAt': now + 5000}
        allocation = self.root / 'allocation.json'
        class Disk:
            f_bavail = self.basis['budget']['minimumFreeBeforeBytes']
            f_frsize = 1
        def check():
            allocation.write_text(json.dumps(grant))
            with patch.object(executor.os, 'statvfs', return_value=Disk()), \
                    patch.object(executor.core.subprocess, 'Popen', side_effect=AssertionError('No native call permitted')):
                return executor.owned_allocation(allocation, output, self.basis)
        self.assertEqual(check(), grant)
        for key, value in [('kind', 'slax-root-source-native-scroll-build-allocation'),
                ('allowSourceSwiftCompile', True), ('allowSignOrVerifyCommands', True),
                ('allowOldDerivedDataReuse', True), ('basisSHA256', '0' * 64), ('exclusiveNativeSlot', 1)]:
            old = grant[key]; grant[key] = value
            with self.subTest(key=key), self.assertRaises(ValueError):
                check()
            grant[key] = old
        self.assertFalse(output.exists())

    def test_command_membership_remains_one_control_only_build_without_shell_copy_or_sign(self):
        tree = ast.parse(Path(executor.__file__).read_text())
        execute = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == 'execute')
        calls = [node for node in ast.walk(execute) if isinstance(node, ast.Call)]
        self.assertEqual(sum(isinstance(node.func, ast.Attribute) and node.func.attr == 'bounded_command' for node in calls), 1)
        values = [node.value for node in ast.walk(execute) if isinstance(node, ast.Constant) and isinstance(node.value, str)]
        self.assertIn('build-for-testing', values)
        self.assertIn('xcodebuild', values)
        for forbidden in ['swiftc', 'codesign', 'test-without-building', 'archive', 'install', 'boot']:
            self.assertNotIn(forbidden, values)
        self.assertEqual(sum(isinstance(node.func, ast.Attribute) and node.func.attr in ('copy', 'copyfile', 'copytree') for node in calls), 0)
        for flag in ['CLANG_ENABLE_COMPILE_CACHE=NO', 'SWIFT_ENABLE_COMPILE_CACHE=NO', 'COMPILATION_CACHE_ENABLE_CACHING=NO']:
            self.assertEqual(values.count(flag), 1)


if __name__ == '__main__':
    unittest.main(verbosity=2)
