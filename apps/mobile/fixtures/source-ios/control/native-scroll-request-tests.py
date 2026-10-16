"""Host guards for the actual new request builder; these cannot establish native input."""
import copy
import importlib.util
from pathlib import Path
import unittest

path = Path(__file__).with_name('prepare-native-scroll.py')
spec = importlib.util.spec_from_file_location('source_native_request', path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def observed():
    geometry = {'offsetYPoints': -384.6666666666667, 'topInsetPoints': 384.6666564941406,
                'contentWidthPoints': 402, 'contentHeightPoints': 1440,
                'viewportWidthPoints': 402, 'viewportHeightPoints': 874,
                'positionPixels': 0, 'frameInWindow': {'x': 0, 'y': 0, 'width': 402, 'height': 874},
                'windowAttached': True, 'loading': False, 'dragging': False, 'decelerating': False}
    return {'kind': 'original-source-native-reader-observation', 'controlledFixture': True,
            'fixtureVersion': 1, 'bundleIdentifier': 'app.slax.reader.sourcefixture', 'state': 'observing',
            'observationNonce': '5845313D-0BCC-4201-A760-530DF89F5D99',
            'webIdentity': '5A5E75B5-686F-4F0D-8B80-10BF2E2B7ECA',
            'scale': 3, 'appearance': 'light', 'preferredContentSizeCategory': 'UICTContentSizeCategoryL',
            'safeTopPoints': 62, 'safeBottomPoints': 34,
            'sourcePreparedStatus': {'controlledFixture': True, 'fixtureVersion': 1, 'state': 'prepared',
                'scenario': 'reader-mixed', 'route': 'Reader', 'locale': 'en', 'selectedActionIndex': -1,
                'fixtureInputSha256': module.FIXTURE_SHA, 'sourceManifestSha256': module.SOURCE_SHA},
            'nativeKvoEvents': [], 'nativeKvoEventCount': 0,
            'samples': [{'sequence': i, 'elapsedSeconds': 3 + i * .2,
                         'observedAtUnixSeconds': 100 + i * .2, 'bodyAndBridgeReady': True,
                         'geometry': copy.deepcopy(geometry)} for i in range(3)]}


class ActualRequestGuards(unittest.TestCase):
    def test_actual_measurement_proposes_input_without_accepting_result(self):
        request = module.checked_request(observed(), 1, now=100.4)
        self.assertEqual(request['startPoints'], {'x': 360, 'y': 600})
        self.assertEqual(request['endPoints'], {'x': 360, 'y': 520})
        self.assertFalse(request['nativeInteractionVerified'])
        self.assertFalse(request['positionAccepted'])

    def test_stale_or_expired_observer_fails_closed(self):
        with self.assertRaises(ValueError): module.checked_request(observed(), 1, now=103)
        value = observed(); value['state'] = 'observation-completed'
        with self.assertRaises(ValueError): module.checked_request(value, 1, now=100.4)

    def test_different_runtime_fixture_or_source_route_is_rejected(self):
        for key, replacement in [('fixtureInputSha256', '5b8ee1cbf4a48e13c64a83dda9161bbae308e451e47ac96fecbb1d9bf49e23b4'), ('route', 'Library'), ('selectedActionIndex', 2)]:
            value = observed(); value['sourcePreparedStatus'][key] = replacement
            with self.subTest(key=key), self.assertRaises(ValueError): module.checked_request(value, 1, now=100.4)

    def test_real_layout_and_callback_state_cannot_be_replaced_by_requested_pixels(self):
        for key, replacement in [('contentWidthPoints', 980), ('dragging', True), ('decelerating', True), ('positionPixels', 240)]:
            value = observed(); value['samples'][-1]['geometry'][key] = replacement
            with self.subTest(key=key), self.assertRaises(ValueError): module.checked_request(value, 1, now=100.4)

    def test_unready_dom_wrong_frame_nan_and_fake_callbacks_are_rejected(self):
        changes = [lambda v: v['samples'][-1].update(bodyAndBridgeReady=False),
                   lambda v: v['samples'][-1]['geometry']['frameInWindow'].update(y=44),
                   lambda v: v['samples'][-1]['geometry'].update(offsetYPoints=float('nan')),
                   lambda v: v.update(nativeKvoEvents=[{'kind': 'prepared-scroll', 'sequence': 1}])]
        for change in changes:
            value = observed(); change(value)
            with self.subTest(change=change), self.assertRaises(ValueError): module.checked_request(value, 1, now=100.4)

    def test_three_input_bound_and_already_matching_state(self):
        with self.assertRaises(ValueError): module.checked_request(observed(), 4, now=100.4)
        value = observed()
        for sample in value['samples']:
            sample['geometry'].update(offsetYPoints=-304, topInsetPoints=384, positionPixels=240)
        with self.assertRaisesRegex(ValueError, 'Already measured240'):
            module.checked_request(value, 1, now=100.4)


if __name__ == '__main__': unittest.main()
