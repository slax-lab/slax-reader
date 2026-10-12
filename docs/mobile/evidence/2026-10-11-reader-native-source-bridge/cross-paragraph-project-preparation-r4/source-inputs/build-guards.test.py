"""Pure executor guards; never import a compiler or invoke a child process."""
import importlib.util
import json
import tempfile
from pathlib import Path
import unittest
from unittest.mock import Mock, patch
import xml.etree.ElementTree as ET

path = Path(__file__).with_name('build.py')
spec = importlib.util.spec_from_file_location('prepared_cross_paragraph_build', path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class PreparedBuildGuards(unittest.TestCase):
    def plan(self):
        return json.loads(module.PLAN_PATH.read_bytes())

    def test_closed_plan_and_generic_build_only_command(self):
        dd = module.checked_plan(self.plan())
        args = module.command(dd)
        self.assertEqual(args[-1], 'build-for-testing')
        self.assertIn('generic/platform=iOS Simulator', args)
        self.assertIn('ARCHS=arm64', args)
        self.assertIn('CODE_SIGNING_ALLOWED=NO', args)
        for flag in ['COMPILATION_CACHE_ENABLE_CACHING=NO', 'CLANG_ENABLE_COMPILE_CACHE=NO', 'SWIFT_ENABLE_COMPILE_CACHE=NO']:
            self.assertIn(flag, args)
        self.assertIn('MODULE_CACHE_DIR=' + str(dd / 'ModuleCache.noindex'), args)
        self.assertIn('SDK_STAT_CACHE_DIR=' + str(dd), args)
        self.assertFalse(any(value.startswith('SWIFT_MODULE_CACHE_PATH=') for value in args))
        self.assertNotIn('test', args)
        self.assertNotIn('test-without-building', args)

    def test_sdk_stat_cache_base_is_the_exact_owned_derived_data(self):
        dd = module.checked_plan(self.plan())
        cache_bases = [value.removeprefix('SDK_STAT_CACHE_DIR=') for value in module.command(dd)
                       if value.startswith('SDK_STAT_CACHE_DIR=')]
        self.assertEqual(cache_bases, [str(dd)])
        # Actual r2 Xcode appended this suffix. Its output must now be the
        # unchanged direct-child path admitted by the sparse-file guard.
        emitted = Path(cache_bases[0]) / 'SDKStatCaches.noindex/public.sdkstatcache'
        self.assertEqual(emitted.relative_to(dd).parts, ('SDKStatCaches.noindex', 'public.sdkstatcache'))

    def test_no_path_budget_or_input_list_relaxation(self):
        for key, value in [('derivedDataRoot', '/private/tmp'),
                           ('derivedDataRoot', '/Users/operator/Library/Developer/Xcode/DerivedData'),
                           ('productCapBytes', module.PRODUCT_CAP + 1),
                           ('deadlineSeconds', 181), ('jobs', 2), ('floorBytes', 0)]:
            plan = self.plan(); plan[key] = value
            with self.subTest(key=key), self.assertRaises(ValueError): module.checked_plan(plan)
        plan = self.plan(); plan['inputs'] = plan['inputs'][:-1]
        with self.assertRaises(ValueError): module.checked_plan(plan)

    def test_only_owned_regular_sparse_sdk_cache_excludes_apparent_bytes(self):
        with tempfile.TemporaryDirectory(prefix='slax-cross-sparse-host-') as directory:
            root = Path(directory).resolve()
            cache = root / 'SDKStatCaches.noindex/public.sdkstatcache'
            cache.parent.mkdir()
            with cache.open('wb') as output:
                output.seek(module.PRODUCT_CAP + 1); output.write(b'X')
            self.assertLess(cache.stat().st_blocks * 512, cache.stat().st_size)
            measured = module.tree_accounting(root)
            self.assertEqual(measured['apparentLogicalBytes'], module.PRODUCT_CAP + 2)
            self.assertEqual(measured['logicalBytes'], 0)
            self.assertEqual(measured['regularSparseSDKStatCaches'], [{
                'path': str(cache), 'apparentBytes': cache.stat().st_size,
                'allocatedBytes': cache.stat().st_blocks * 512}])
            module.resource_guard(measured, module.FLOOR, 0)
            too_many_blocks = dict(measured, allocatedBytes=module.PRODUCT_CAP)
            with self.assertRaises(ValueError): module.resource_guard(too_many_blocks, module.FLOOR, 0)
            # A sparse file under Products or an unrelated cache name remains
            # a true product even if its filesystem allocation is tiny.
            for relative in ['Build/Products/unexpected.sdkstatcache', 'SDKStatCaches.noindex/unexpected.cache']:
                other = root / relative; other.parent.mkdir(parents=True, exist_ok=True)
                with other.open('wb') as output:
                    output.seek(module.PRODUCT_CAP + 1); output.write(b'X')
                with self.assertRaises(ValueError): module.resource_guard(module.tree_accounting(root), module.FLOOR, 0)
                other.unlink()
            # A cache-path symlink cannot gain the regular-sparse exception.
            alias = root / 'SDKStatCaches.noindex/link.sdkstatcache'; alias.symlink_to(cache)
            self.assertEqual(len(module.tree_accounting(root)['regularSparseSDKStatCaches']), 1)

    def test_monitor_accepts_only_vanished_generated_entries_during_active_build(self):
        with tempfile.TemporaryDirectory(prefix='slax-cross-monitor-host-') as directory:
            root = Path(directory).resolve()
            temporary = root / 'ModuleCache.noindex/temporary.pcm.tmp'
            protected = root / 'Project/ReaderCrossParagraphControl.swift'
            for path in [temporary, protected]:
                path.parent.mkdir(); path.write_bytes(b'public')
            actual_lstat = Path.lstat
            def absent_generated(path):
                if path == temporary: raise FileNotFoundError(2, 'Compiler renamed temporary file', str(path))
                return actual_lstat(path)
            with patch.object(Path, 'lstat', absent_generated):
                measured = module.tree_accounting(root, active_build=True)
                self.assertEqual(measured['vanishedGeneratedEntriesDuringActiveBuild'], [str(temporary)])
                with self.assertRaises(FileNotFoundError): module.tree_accounting(root)
            def absent_protected(path):
                if path == protected: raise FileNotFoundError(2, 'Immutable project input missing', str(path))
                return actual_lstat(path)
            with patch.object(Path, 'lstat', absent_protected):
                with self.assertRaises(FileNotFoundError): module.tree_accounting(root, active_build=True)
            def denied_generated(path):
                if path == temporary: raise PermissionError(13, 'Permission denied', str(path))
                return actual_lstat(path)
            with patch.object(Path, 'lstat', denied_generated):
                with self.assertRaises(PermissionError): module.tree_accounting(root, active_build=True)

    def test_only_three_observed_regular_sparse_compilation_metadata_files_exclude_apparent_bytes(self):
        with tempfile.TemporaryDirectory(prefix='slax-cross-metadata-host-') as directory:
            root = Path(directory).resolve()
            for relative, length in module.SPARSE_COMPILATION_METADATA.items():
                path = root / relative; path.parent.mkdir(parents=True, exist_ok=True)
                with path.open('wb') as output:
                    output.seek(length - 1); output.write(b'X')
            measured = module.tree_accounting(root)
            self.assertEqual(measured['apparentLogicalBytes'], sum(module.SPARSE_COMPILATION_METADATA.values()))
            self.assertEqual(measured['logicalBytes'], 0)
            self.assertEqual(measured['regularSparseCompilationMetadata'], sorted([
                {'path': str(root / relative), 'apparentBytes': length,
                 'allocatedBytes': (root / relative).stat().st_blocks * 512}
                for relative, length in module.SPARSE_COMPILATION_METADATA.items()], key=lambda entry: entry['path']))
            module.resource_guard(measured, module.FLOOR, 0)
            with self.assertRaises(ValueError):
                module.resource_guard(dict(measured, allocatedBytes=module.PRODUCT_CAP), module.FLOOR, 0)
            for relative, length in [
                ('CompilationCache.noindex/generic/v1.1/unexpected.data', 1073741824),
                ('CompilationCache.noindex/generic/v1.2/v3.actions', 1073741824),
                ('Build/Products/v3.actions', 1073741824),
                ('CompilationCache.noindex/generic/v1.1/v3.actions', 1073741825),
            ]:
                path = root / relative; path.parent.mkdir(parents=True, exist_ok=True)
                existed = path.exists()
                with path.open('wb') as output:
                    output.seek(length - 1); output.write(b'X')
                with self.subTest(relative=relative, length=length), self.assertRaises(ValueError):
                    module.resource_guard(module.tree_accounting(root), module.FLOOR, 0)
                path.unlink()
                if existed:
                    with path.open('wb') as output:
                        output.seek(module.SPARSE_COMPILATION_METADATA[relative] - 1); output.write(b'X')
            # A matching path/length without sparse allocation cannot qualify.
            actual_lstat = Path.lstat
            target = root / 'CompilationCache.noindex/generic/v1.1/v3.actions'
            def nonsparse(path):
                value = actual_lstat(path)
                if path != target: return value
                return Mock(st_mode=value.st_mode, st_size=value.st_size,
                            st_blocks=(value.st_size + 511) // 512)
            with patch.object(Path, 'lstat', nonsparse), self.assertRaises(ValueError):
                module.resource_guard(module.tree_accounting(root), module.FLOOR, 0)
            target.unlink(); target.symlink_to(root / 'CompilationCache.noindex/generic/v1.1/v8.data')
            self.assertEqual(len(module.tree_accounting(root)['regularSparseCompilationMetadata']), 2)

    def test_resource_floor_reserve_and_all_owned_output_caps(self):
        size = {'logicalBytes': 0, 'allocatedBytes': 0}
        module.resource_guard(size, module.RESERVE_FLOOR, 0, before=True)
        for kwargs in [dict(accounting=size, free=module.RESERVE_FLOOR - 1, log_size=0, before=True),
                       dict(accounting=size, free=module.FLOOR - 1, log_size=0),
                       dict(accounting={'logicalBytes': module.PRODUCT_CAP + 1, 'allocatedBytes': 0}, free=module.FLOOR, log_size=0),
                       dict(accounting={'logicalBytes': 0, 'allocatedBytes': module.PRODUCT_CAP + 1}, free=module.FLOOR, log_size=0),
                       dict(accounting=size, free=module.FLOOR, log_size=module.LOG_CAP + 1)]:
            with self.subTest(kwargs=kwargs), self.assertRaises(ValueError): module.resource_guard(**kwargs)

    def test_only_new_driver_and_zero_input_bitmap_preflight_are_members(self):
        root = module.PROJECT_ROOT
        project = (root / 'CrossParagraphControl.xcodeproj/project.pbxproj').read_text()
        self.assertIn('path = ReaderCrossParagraphControl.swift;', project)
        self.assertIn('path = ControlHost.swift;', project)
        self.assertIn('path = reference-alpha.png;', project)
        for forbidden in ['ReaderNativeControl.swift', 'SlaxReader.xcodeproj', 'Pods', 'CODE_SIGN_ENTITLEMENTS', 'group.app.slax.reader']:
            self.assertNotIn(forbidden, project)
        scheme = ET.parse(root / 'CrossParagraphControl.xcodeproj/xcshareddata/xcschemes/CrossParagraphControl.xcscheme')
        selected = [e.attrib['Identifier'] for e in scheme.findall('.//SelectedTests/Test')]
        self.assertEqual(selected, [
            'ReaderCrossParagraphBitmapPreflight/testArchivedNativeSelectionHandlesBitmapOrientation()',
            'ReaderCrossParagraphControl/testNativeEndHandleDragFromGenuineAlphaTowardSecondParagraph()'])

    def test_zero_input_preflight_does_not_activate_a_target_or_change_original_driver(self):
        compiled = (module.PROJECT_ROOT / 'ReaderCrossParagraphControl.swift').read_bytes()
        original = module.PROJECT_ROOT.parent / 'ReaderCrossParagraphControl.swift'
        self.assertEqual(module.digest(original), '7f249347649b419322a93445ec344b4f414414327807e9095bb68214387d5adc')
        self.assertTrue(compiled.startswith(original.read_bytes()))
        appended = compiled[len(original.read_bytes()):].decode()
        for forbidden in ['XCUIApplication(', 'thenDragTo', 'evaluateJavaScript', '.tap(', 'setContentOffset']:
            self.assertNotIn(forbidden, appended)
        self.assertIn('NativeSelectionHandlePixels.inspect', appended)

    def test_refuses_to_signal_an_unrelated_process_group(self):
        process = Mock(pid=101)
        process.poll.return_value = None
        with patch.object(module.os, 'getpgid', return_value=999), patch.object(module.os, 'killpg') as kill:
            with self.assertRaisesRegex(ValueError, 'not created by this executor'):
                module.stop_own_process_group(process)
            kill.assert_not_called()

    def test_timeout_stops_only_the_created_process_group_with_finite_grace(self):
        process = Mock(pid=101)
        process.poll.return_value = None
        process.wait.side_effect = [module.subprocess.TimeoutExpired('owned', 2), -9]
        with patch.object(module.os, 'getpgid', return_value=101), patch.object(module.os, 'killpg') as kill:
            module.stop_own_process_group(process)
            self.assertEqual([call.args for call in kill.call_args_list],
                             [(101, module.signal.SIGTERM), (101, module.signal.SIGKILL)])
            self.assertEqual([call.kwargs for call in process.wait.call_args_list],
                             [{'timeout': 2}, {'timeout': 2}])


if __name__ == '__main__': unittest.main()
