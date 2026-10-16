"""Native input refuses ambiguous, disabled, out-of-window and external-app controls."""
import importlib.util
import json
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('fixture_android', Path(__file__).parents[2] / 'tooling/fixture-android-batch.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
APP = module.APP


def document(*nodes):
    return '<hierarchy>' + ''.join(nodes) + '</hierarchy>'


def button(package=APP, enabled='true', bounds='[10,20][40,60]'):
    return f'<node package="{package}" text="" content-desc="Menu" clickable="true" enabled="{enabled}" bounds="{bounds}"/>'


class FixtureAndroidControl(unittest.TestCase):
    def test_real_declared_reader_overlays_do_not_accumulate(self):
        cases = json.loads((Path(__file__).parents[2] / 'fixtures/scenarios.json').read_text())['scenarios']
        mixed = cases['reader-mixed']['actions']
        self.assertEqual([module.prepared_action_plan(mixed, i) for i in range(len(mixed))], [[0], [1], [2], [3], [4]])
        streamed = cases['reader-ai-stream']['actions']
        self.assertEqual(module.prepared_action_plan(streamed, 5), [4, 5])
        self.assertNotIn(0, module.prepared_action_plan(streamed, 5))
        self.assertEqual(module.prepared_action_plan(cases['feedback-error']['actions'], 1), [0, 1])
        self.assertEqual(module.prepared_action_plan(cases['rss-populated']['actions'], 1), [0, 1])

    def test_native_player_and_stream_timing_cannot_be_certified_by_preparation(self):
        for kind in ['native-back', 'resume', 'video-event', 'tap-cue', 'capture-stream-chunk', 'wait-stream-done']:
            with self.assertRaises(ValueError):
                module.prepared_action_plan([{'kind': kind}], 0)
        for index in [-1, True, 1]:
            with self.assertRaises(ValueError):
                module.prepared_action_plan([{'kind': 'open-image'}], index)

    def test_launcher_resolution_cannot_resume_another_identity_or_deep_link(self):
        self.assertEqual(module.launcher_component('priority=0\n' + APP + '/.MainActivity\n'), APP + '/.MainActivity')
        for raw in ['com.slax.reader/.MainActivity', APP + '/.OtherActivity', APP + '/.MainActivity\ncom.other/.MainActivity', 'No activity found']:
            with self.assertRaises(RuntimeError):
                module.launcher_component(raw)

    def test_unique_observed_native_bounds_and_clickable_ancestor(self):
        tree, _ = module.xml_nodes(document(f'<node package="{APP}" clickable="true" enabled="true" bounds="[10,20][40,60]"><node package="{APP}" text="Settings" clickable="false"/></node>'))
        node, point = module.clickable_target(tree, 'text', 'Settings')
        self.assertEqual(point, (25, 40))
        self.assertEqual(node.get('clickable'), 'true')

    def test_ambiguous_disabled_and_outside_controls_are_rejected(self):
        for raw in [document(button(), button()), document(button(enabled='false')), document(button(bounds='[10,20][2000,60]'))]:
            tree, _ = module.xml_nodes(raw)
            with self.assertRaises(RuntimeError):
                module.clickable_target(tree, 'content-desc', 'Menu')

    def test_other_apps_and_native_error_overlays_are_rejected(self):
        for raw in [document(button(package='com.slax.reader')), document(f'<node package="{APP}" text="Render Error"/>'), document(f'<node package="{APP}" text="Runtime version: exposdk:57.0.0"/>')]:
            with self.assertRaises(RuntimeError):
                module.xml_nodes(raw)

    def test_document_scroll_targets_nested_chromium_document_and_rejects_ambiguity(self):
        def webview(scrollable, enabled='true'):
            return f'<node package="{APP}" class="android.webkit.WebView" scrollable="{scrollable}" enabled="{enabled}" bounds="[0,304][1080,2051]"/>'
        _, nodes = module.xml_nodes(document(webview('false'), webview('true')))
        self.assertEqual(module.scrollable_document(nodes).get('scrollable'), 'true')
        for raw in [document(webview('true'), webview('true')), document(webview('false')), document(webview('true', 'false'))]:
            _, nodes = module.xml_nodes(raw)
            with self.assertRaises(RuntimeError):
                module.scrollable_document(nodes)

    def test_keyboard_allowance_is_bounded_to_the_observed_ime_and_requires_own_app(self):
        keyboard = '<node package="com.google.android.inputmethod.latin" text="Gboard"/>'
        with self.assertRaises(RuntimeError):
            module.xml_nodes(document(button(), keyboard))
        _, nodes = module.xml_nodes(document(button(), keyboard), allow_keyboard=True)
        self.assertEqual(len(nodes), 2)
        for raw in [document(keyboard), document(button(), '<node package="com.other.app"/>')]:
            with self.assertRaises(RuntimeError):
                module.xml_nodes(raw, allow_keyboard=True)


if __name__ == '__main__':
    unittest.main()
