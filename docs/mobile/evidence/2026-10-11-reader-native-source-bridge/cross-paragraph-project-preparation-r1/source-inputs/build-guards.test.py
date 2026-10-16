"""Pure executor guards; never import a compiler or invoke a child process."""
import importlib.util
import json
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
        self.assertNotIn('test', args)
        self.assertNotIn('test-without-building', args)

    def test_no_path_budget_or_input_list_relaxation(self):
        for key, value in [('derivedDataRoot', '/private/tmp'),
                           ('derivedDataRoot', '/Users/operator/Library/Developer/Xcode/DerivedData'),
                           ('productCapBytes', module.PRODUCT_CAP + 1),
                           ('deadlineSeconds', 181), ('jobs', 2), ('floorBytes', 0)]:
            plan = self.plan(); plan[key] = value
            with self.subTest(key=key), self.assertRaises(ValueError): module.checked_plan(plan)
        plan = self.plan(); plan['inputs'] = plan['inputs'][:-1]
        with self.assertRaises(ValueError): module.checked_plan(plan)

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
