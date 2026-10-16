#!/usr/bin/env python3
"""Capture closed shared cases and exercise isolated native navigation; never certify parity."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import struct
import subprocess
import time
from uuid import uuid4
import xml.etree.ElementTree as ET

APP = 'com.slax.reader.uifixture'
ROOT = Path(__file__).resolve().parents[3]
MOBILE = ROOT / 'apps/mobile'
DEVICE_NAME = 'sdk_gphone64_arm64 - 14 - API 34'
DRIVER_SOURCE = Path(__file__).read_bytes()


def run(arguments, binary=False):
    result = subprocess.run(arguments, capture_output=True, timeout=30, text=not binary)
    if result.returncode:
        error = result.stderr.decode(errors='replace') if binary else result.stderr
        raise RuntimeError(f'Controlled command failed ({result.returncode}): {error.strip()}')
    return result.stdout


def adb(serial, *arguments, binary=False):
    return run(['adb', '-s', serial, *arguments], binary=binary)


def control(case=None, observe=False, action=None):
    args = ['node', str(MOBILE / 'tooling/fixture-control.mjs'), '--platform', 'android', '--device', DEVICE_NAME]
    args += ['--case', case, '--locale', 'en', '--font-scale', '1'] if case else ['--observe', 'current'] if observe else ['--action', json.dumps(action)]
    return json.loads(run(args))


def xml_nodes(raw):
    tree = ET.fromstring(raw)
    nodes = list(tree.iter('node'))
    if not nodes or any(node.get('package') not in (APP, '') for node in nodes):
        raise RuntimeError('Native hierarchy belongs to another app or retained system overlay')
    text = '\n'.join(node.get('text', '') + '\n' + node.get('content-desc', '') for node in nodes)
    if any(value in text for value in ['There was a problem loading the project', 'Render Error', 'Maximum update depth exceeded', 'Runtime version: exposdk:', 'This is the developer menu.']):
        raise RuntimeError('Development/error overlay prevents native capture acceptance')
    return tree, nodes


def clickable_target(tree, attribute, value):
    parents = {child: parent for parent in tree.iter() for child in parent}
    matches = [node for node in tree.iter('node') if node.get(attribute) == value]
    candidates = []
    for node in matches:
        while node.get('clickable') != 'true' and node in parents:
            node = parents[node]
        if node.get('clickable') == 'true' and node.get('enabled') == 'true' and node not in candidates:
            candidates.append(node)
    if len(candidates) != 1:
        raise RuntimeError(f'Native control must be unique, clickable and enabled: {attribute}={value}')
    node = candidates[0]
    match = re.fullmatch(r'\[(\d+),(\d+)\]\[(\d+),(\d+)\]', node.get('bounds', ''))
    if not match:
        raise RuntimeError('Native control has no measured bounds')
    left, top, right, bottom = map(int, match.groups())
    if not (0 <= left < right <= 1080 and 0 <= top < bottom <= 2400):
        raise RuntimeError('Native control lies outside the measured display')
    return node, ((left + right) // 2, (top + bottom) // 2)


def launcher_component(raw):
    components = [line.strip() for line in raw.splitlines() if '/' in line]
    if components != [APP + '/.MainActivity']:
        raise RuntimeError('Only the observed independent fixture launcher Activity may resume')
    return components[0]


def prepared_action_plan(actions, index):
    if not isinstance(index, int) or isinstance(index, bool) or index < 0 or index >= len(actions):
        raise ValueError('Unknown declared preparation action index')
    kind = actions[index]['kind']
    if kind in ['native-back', 'resume', 'video-event', 'tap-cue', 'capture-stream-chunk', 'wait-stream-done']:
        raise ValueError('This state requires a separate native/player/stream-timing driver')
    if kind in ['selection', 'open-comment', 'open-overview', 'open-outline', 'open-image', 'open-transcript', 'select-list', 'scroll']:
        return [index]
    if kind in ['generate-overview', 'generate-outline']:
        opener = 'open-' + kind.removeprefix('generate-')
        prior = [i for i in range(index) if actions[i]['kind'] == opener]
        if not prior:
            raise ValueError('AI preparation requires its declared visible overlay')
        return [prior[-1], index]
    # Forms, agreements and RSS controls need their declared preceding inputs.
    # These workflows contain no Reader sheets, so they preserve dependencies
    # without carrying a comment/overview/Pro dialog into another overlay frame.
    if kind in ['select-source', 'source-menu', 'load-history', 'type', 'press', 'begin-login', 'select-agreement', 'dismiss-agreement', 'accept-agreement', 'save-rss', 'press-delete', 'confirm-delete', 'background-flush']:
        return list(range(index + 1))
    raise ValueError('Declared preparation action has no reviewed driver plan')


class Driver:
    def __init__(self, serial, output):
        self.serial, self.output = serial, output
        self.sequence = 0
        self.records = []
        output.mkdir(parents=True, exist_ok=False)
        (output / 'executed-driver.py').write_bytes(DRIVER_SOURCE)

    def hierarchy(self):
        window = adb(self.serial, 'shell', 'dumpsys', 'window')
        focus = next((line.strip() for line in window.splitlines() if 'mCurrentFocus=' in line), '')
        if APP + '/' not in focus or 'MainActivity' not in focus:
            raise RuntimeError('Independent target MainActivity must be the actual focused native window: ' + focus)
        adb(self.serial, 'shell', 'uiautomator', 'dump', '/sdcard/slax-uifixture-batch-window.xml')
        raw = adb(self.serial, 'exec-out', 'cat', '/sdcard/slax-uifixture-batch-window.xml')
        tree, nodes = xml_nodes(raw)
        return raw, tree, nodes, focus

    def capture(self, name, expected_route=None, input_record=None, prepared=None, expected_nodes=(), forbidden_nodes=(), prepared_action_indices=None):
        self.sequence += 1
        directory = self.output / f'{self.sequence:02d}-{name}'
        directory.mkdir()
        error = None
        try:
            time.sleep(.5)
            observation = prepared if prepared is not None else control(observe=True)
            # Read again after settling: preparation can precede the first native mount.
            observation = control(observe=True)
            actual_route = observation['renderContext'].get('observedRoute')
            if input_record and input_record.get('method') == 'adb-native-resume-own-launcher' and input_record['stateRetention'] != 'retained':
                raise RuntimeError('Native launcher resume did not retain the measured fixture scope and navigation stack')
            if expected_route is not None and (not actual_route or actual_route['name'] != expected_route):
                raise RuntimeError(f'Native candidate route differs: expected {expected_route}, observed {actual_route}')
            raw, tree, nodes, focus = self.hierarchy()
            if expected_route == 'Library' and not expected_nodes and not any(node.get('content-desc') == 'Switch List' for node in nodes):
                raise RuntimeError('Library native switch control is missing')
            if expected_route == 'Settings' and not expected_nodes and not any(node.get('resource-id') == 'setting_language' for node in nodes):
                raise RuntimeError('Settings native language control is missing')
            if expected_route == 'Feedback' and not any(node.get('resource-id') == 'feedback_input' for node in nodes):
                raise RuntimeError('Feedback native input is missing')
            if expected_route == 'Reader' and not any(node.get('class') == 'android.webkit.WebView' for node in nodes):
                raise RuntimeError('Reader native WebView is missing')
            for attribute, value in expected_nodes:
                if not any(node.get(attribute) == value for node in nodes):
                    raise RuntimeError(f'Expected native state is missing: {attribute}={value}')
            for attribute, value in forbidden_nodes:
                if any(node.get(attribute) == value for node in nodes):
                    raise RuntimeError(f'Previous native state is retained: {attribute}={value}')
            (directory / 'native-hierarchy.xml').write_text(raw)
            (directory / 'runtime-context.json').write_text(json.dumps(observation, indent=2) + '\n')
            image = adb(self.serial, 'exec-out', 'screencap', '-p', binary=True)
            if image[:8] != b'\x89PNG\r\n\x1a\n' or struct.unpack('>II', image[16:24]) != (1080, 2400):
                raise RuntimeError('Unexpected native screenshot format/dimensions')
            (directory / 'native.png').write_bytes(image)
            record = {'name': name, 'result': 'native-candidate-captured', 'expectedRoute': expected_route, 'observedRoute': actual_route,
                      'focusedWindow': focus, 'nativeInput': input_record, 'nativeInteractionVerified': input_record is not None,
                      'expectedNativeState': list(expected_nodes), 'forbiddenNativeState': list(forbidden_nodes),
                      'preparedActionIndices': prepared_action_indices, 'preparationOnly': prepared_action_indices is not None,
                      'preparedScenario': observation['scenario'], 'fixtureInputSha256': observation['inputSha256'],
                      'nativeMeasurements': observation['renderContext']['nativeMeasurements'],
                      'visualInspection': 'pending', 'sourceParity': 'unverified', 'capturedAtMillis': round(time.time() * 1000)}
        except Exception as reason:
            error = str(reason)
            record = {'name': name, 'result': 'failed', 'error': error, 'nativeInteractionVerified': False, 'nativeInput': input_record, 'capturedAtMillis': round(time.time() * 1000), 'sourceParity': 'unverified'}
            # Rejected diagnostics stay separate from candidate frames.
            try:
                (directory / 'rejected-diagnostic.png').write_bytes(adb(self.serial, 'exec-out', 'screencap', '-p', binary=True))
            except Exception:
                pass
        record['files'] = [{'path': str(path.relative_to(self.output)), 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'bytes': path.stat().st_size} for path in directory.iterdir()]
        (directory / 'record.json').write_text(json.dumps(record, indent=2) + '\n')
        self.records.append(record)
        self.save()
        print(json.dumps({'name': name, 'result': record['result'], 'error': error}), flush=True)
        if error:
            raise RuntimeError(error)
        return record

    def save(self):
        (self.output / 'batch.json').write_text(json.dumps({'kind': 'isolated-target-native-route-batch', 'schemaVersion': 1, 'appId': APP, 'device': self.serial,
            'driverSha256': hashlib.sha256(DRIVER_SOURCE).hexdigest(), 'records': self.records, 'overallParity': 'unverified',
            'limitations': ['Native route/control guards do not replace inspection of the candidate PNG.', 'Prepared routes/actions are distinct from logged native input.', 'Source matching, remaining locales/profiles and complete state matrix remain pending.']}, indent=2) + '\n')

    def tap(self, attribute, value):
        _, tree, _, focus = self.hierarchy()
        node, point = clickable_target(tree, attribute, value)
        before = dict(node.attrib)
        observation = control(observe=True)
        adb(self.serial, 'shell', 'input', 'tap', str(point[0]), str(point[1]))
        time.sleep(.5)
        return {'method': 'adb-native-input-tap', 'selector': {attribute: value}, 'observedNode': before, 'pointPixels': {'x': point[0], 'y': point[1]}, 'focusedWindowBeforeInput': focus, 'observedBefore': observation['renderContext']}

    def back(self):
        _, _, _, focus = self.hierarchy()
        observation = control(observe=True)
        adb(self.serial, 'shell', 'input', 'keyevent', 'KEYCODE_BACK')
        time.sleep(.5)
        return {'method': 'adb-native-system-back', 'keycode': 'KEYCODE_BACK', 'focusedWindowBeforeInput': focus, 'scopeBefore': observation['scopeUri'], 'observedBefore': observation['renderContext']}

    def root_fallback(self, input_record):
        self.resume_before = input_record
        self.sequence += 1
        directory = self.output / f'{self.sequence:02d}-native-root-back-fallback'
        directory.mkdir()
        window = adb(self.serial, 'shell', 'dumpsys', 'window')
        focus = next((line.strip() for line in window.splitlines() if 'mCurrentFocus=' in line), '')
        passed = 'com.google.android.apps.nexuslauncher/' in focus and input_record['observedBefore']['observedNavigationState']['canGoBack'] is False
        (directory / ('native.png' if passed else 'rejected-diagnostic.png')).write_bytes(adb(self.serial, 'exec-out', 'screencap', '-p', binary=True))
        record = {'name': 'native-root-back-fallback', 'result': 'native-root-fallback-observed' if passed else 'failed', 'nativeInput': input_record,
                  'focusedWindow': focus, 'observedRoute': None, 'nativeInteractionVerified': passed, 'capturedAtMillis': round(time.time() * 1000), 'sourceParity': 'unverified'}
        record['files'] = [{'path': str(path.relative_to(self.output)), 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'bytes': path.stat().st_size} for path in directory.iterdir()]
        (directory / 'record.json').write_text(json.dumps(record, indent=2) + '\n')
        self.records.append(record)
        self.save()
        print(json.dumps({'name': record['name'], 'result': record['result']}), flush=True)
        if not passed:
            raise RuntimeError('Native root Back did not reach the observed controlled launcher')

    def resume(self):
        component = launcher_component(adb(self.serial, 'shell', 'cmd', 'package', 'resolve-activity', '--brief', '-a', 'android.intent.action.MAIN', '-c', 'android.intent.category.LAUNCHER', APP))
        adb(self.serial, 'shell', 'am', 'start', '-a', 'android.intent.action.MAIN', '-c', 'android.intent.category.LAUNCHER', '-n', component)
        deadline = time.monotonic() + 20
        while time.monotonic() < deadline:
            try:
                observation = control(observe=True)
                if observation['renderContext']['observedRoute']['name'] == 'Library':
                    before = self.resume_before
                    retained = observation['scopeUri'] == before['scopeBefore'] and observation['renderContext']['observedNavigationState'] == before['observedBefore']['observedNavigationState']
                    return {'method': 'adb-native-resume-own-launcher', 'package': APP, 'component': component, 'scopeBefore': before['scopeBefore'],
                            'scopeAfter': observation['scopeUri'], 'observedBefore': before['observedBefore'], 'observedAfter': observation['renderContext'], 'stateRetention': 'retained' if retained else 'recreated'}
            except Exception:
                pass
            time.sleep(.5)
        raise RuntimeError('Isolated native activity failed to resume to its real Library stack')

    def wait_reader_ready(self):
        deadline = time.monotonic() + 12
        while time.monotonic() < deadline:
            try:
                observed = control(action={'kind': 'inspect-position'})
                prefix = 'file:///data/user/0/' + APP + '/'
                scope = observed['scopeUri']
                if not scope.startswith(prefix):
                    raise RuntimeError('Reader diagnostic belongs to another application scope')
                relative = scope[len(prefix):]
                if not re.fullmatch(r'cache/slax-ui-fixtures/[a-z0-9-]+/', relative):
                    raise RuntimeError('Unexpected isolated Reader diagnostic directory')
                position = json.loads(adb(self.serial, 'exec-out', 'run-as', APP, 'cat', relative + 'reader-position.json'))
                if position.get('controlledFixture') is True and position.get('fixtureVersion') == 1 and position.get('bridge', {}).get('ready') is True and position['bridge'].get('documentLoaded') is True:
                    return position
            except Exception:
                pass
            time.sleep(.25)
        raise RuntimeError('Actual native Reader bridge/document readiness was not observed')

    def start_recording(self):
        self.recording_path = f'/sdcard/slax-uifixture-native-{uuid4()}.mp4'
        self.recording = subprocess.Popen(['adb', '-s', self.serial, 'shell', 'screenrecord', '--time-limit', '180', self.recording_path], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        time.sleep(.5)
        if self.recording.poll() is not None:
            raise RuntimeError('Controlled native screen recording did not start')

    def finish_recording(self):
        if self.recording.poll() is None:
            pids = adb(self.serial, 'shell', 'pidof', 'screenrecord').split()
            owned = []
            for pid in pids:
                command = adb(self.serial, 'exec-out', 'cat', f'/proc/{pid}/cmdline')
                if self.recording_path in command:
                    owned.append(pid)
            if len(owned) != 1:
                raise RuntimeError('Unique owned screen recorder process is unavailable')
            adb(self.serial, 'shell', 'kill', '-2', owned[0])
        self.recording.communicate(timeout=10)
        adb(self.serial, 'pull', self.recording_path, str(self.output / 'native-input.mp4'))
        video = self.output / 'native-input.mp4'
        if video.stat().st_size < 1024 or b'ftyp' not in video.read_bytes()[:64]:
            raise RuntimeError('Actual native recording is missing or incomplete')
        path = self.output / 'native-input-log.json'
        events = [{'native': True, 'action': record['name'], 'input': record['nativeInput'], 'observedAfter': record.get('observedRoute'), 'afterGuardResult': record['result'], 'capturedAtMillis': record['capturedAtMillis']} for record in self.records if record.get('nativeInput')]
        path.write_text(json.dumps({'kind': 'scoped-native-input-log', 'platform': 'android', 'appId': APP, 'events': events, 'video': {'path': 'native-input.mp4', 'sha256': hashlib.sha256(video.read_bytes()).hexdigest()}}, indent=2) + '\n')
        self.save()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--device', required=True, choices=['emulator-5560'])
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--mode', required=True, choices=['initial', 'navigation', 'header-navigation', 'root-resume', 'prepared-actions', 'provider-alert-dismiss'])
    parser.add_argument('--case', action='append')
    parser.add_argument('--action-index', type=int)
    args = parser.parse_args()
    if not args.output.is_absolute() or args.output.exists():
        raise RuntimeError('Use a fresh absolute owned output directory')
    if adb(args.device, 'shell', 'getprop', 'ro.kernel.qemu').strip() != '1':
        raise RuntimeError('Controlled emulator required')
    if adb(args.device, 'emu', 'avd', 'name').splitlines()[0] != 'slax-migration-controlled':
        raise RuntimeError('Explicitly allocated controlled AVD required')
    driver = Driver(args.device, args.output)
    adb(args.device, 'shell', 'am', 'broadcast', '-a', 'com.android.systemui.demo', '-e', 'command', 'clock', '-e', 'hhmm', '0941')
    scenarios = json.loads((MOBILE / 'fixtures/scenarios.json').read_text())['scenarios']
    if args.case and (args.mode not in ['initial', 'prepared-actions'] or any(name not in scenarios for name in args.case)):
        raise RuntimeError('Case selection requires closed initial/prepared-action cases')
    if args.action_index is not None and (args.mode != 'prepared-actions' or not args.case or len(args.case) != 1):
        raise RuntimeError('One declared case is required for an isolated action index')
    if args.mode == 'initial':
        for name in args.case or scenarios.keys():
            scenario = scenarios[name]
            try:
                prepared = control(case=name)
                driver.capture(name + '-initial', None if scenario['payload'].get('upgrade') else scenario['route']['name'], prepared=prepared)
            except Exception as error:
                if not driver.records or driver.records[-1]['name'] != name + '-initial':
                    driver.records.append({'name': name + '-initial', 'result': 'preparation-failed', 'error': str(error), 'sourceParity': 'unverified'})
                    driver.save()
                    print(json.dumps(driver.records[-1]), flush=True)
        return
    if args.mode == 'prepared-actions':
        for name in args.case or scenarios.keys():
            scenario = scenarios[name]
            actions = scenario['actions']
            for index in [args.action_index] if args.action_index is not None else range(len(actions)):
                capture_name = f'{name}-prepared-{index:02d}-{actions[index]["kind"]}' if index in range(len(actions)) else f'{name}-unknown-action'
                try:
                    plan = prepared_action_plan(actions, index)
                    control(case=name)
                    if scenario['route']['name'] == 'Reader':
                        driver.wait_reader_ready()
                    for step in plan:
                        control(action=actions[step])
                        time.sleep(.3)
                    driver.capture(capture_name, prepared_action_indices=plan)
                except Exception as error:
                    if not driver.records or driver.records[-1]['name'] != capture_name:
                        driver.records.append({'name': capture_name, 'result': 'preparation-failed', 'error': str(error), 'preparedActionIndex': index,
                                               'preparationOnly': True, 'nativeInteractionVerified': False, 'sourceParity': 'unverified'})
                        driver.save()
                        print(json.dumps(driver.records[-1]), flush=True)
        return
    driver.start_recording()
    try:
        if args.mode == 'provider-alert-dismiss':
            _, _, nodes, _ = driver.hierarchy()
            if not all(any(node.get('text') == expected for node in nodes) for expected in ['Login Failed', 'Synthetic provider failure']):
                raise RuntimeError('Only the observed prepared provider failure alert may be dismissed')
            observed = control(observe=True)
            driver.capture('native-dismiss-observed-provider-alert', observed['renderContext']['observedRoute']['name'], driver.tap('text', 'OK'),
                           forbidden_nodes=[('text', 'Synthetic provider failure')])
        elif args.mode == 'root-resume':
            control(case='library-populated')
            driver.capture('library-before-native-root-back', 'Library')
            driver.root_fallback(driver.back())
            driver.capture('library-native-launcher-resume-after-root-back', 'Library', driver.resume())
        elif args.mode == 'header-navigation':
            control(case='library-populated')
            driver.capture('library-before-native-header-navigation', 'Library')
            driver.capture('native-drawer', 'Library', driver.tap('content-desc', 'Menu'), expected_nodes=[('resource-id', 'sidebar_drawer')])
            driver.capture('settings-before-native-header-back', 'Settings', driver.tap('text', 'Settings'))
            driver.capture('library-after-native-header-back', 'Library', driver.tap('content-desc', 'Navigate up'))
        else:
            native_navigation(driver, scenarios)
    finally:
        driver.finish_recording()


def native_navigation(driver, scenarios):
    control(case='library-populated')
    driver.capture('library-before-native-navigation', 'Library')
    native_input = driver.tap('content-desc', 'Menu')
    driver.capture('library-native-drawer', 'Library', native_input, expected_nodes=[('resource-id', 'sidebar_drawer')])
    native_input = driver.tap('text', 'Settings')
    driver.capture('settings-native-navigation', 'Settings', native_input)
    native_input = driver.tap('resource-id', 'setting_language')
    driver.capture('settings-native-language-dialog', 'Settings', native_input, expected_nodes=[('class', 'android.widget.RadioButton')])
    native_input = driver.back()
    driver.capture('settings-native-language-dismiss', 'Settings', native_input, forbidden_nodes=[('class', 'android.widget.RadioButton')])
    native_input = driver.back()
    driver.capture('library-native-back-from-settings', 'Library', native_input)
    native_input = driver.tap('content-desc', 'Menu')
    driver.capture('library-native-drawer-for-about', 'Library', native_input, expected_nodes=[('resource-id', 'sidebar_drawer')])
    native_input = driver.tap('text', 'About')
    driver.capture('about-native-navigation', 'About', native_input, expected_nodes=[('text', 'Slax Reader')])
    native_input = driver.back()
    driver.capture('library-native-back-from-about', 'Library', native_input)
    _, tree, nodes, _ = driver.hierarchy()
    title = next(node.get('content-desc') for node in nodes if node.get('class') == 'android.widget.Button' and node.get('content-desc', '').startswith('A fixed title with English'))
    native_input = driver.tap('content-desc', title)
    driver.capture('reader-native-row-navigation', 'Reader', native_input)
    native_input = driver.back()
    driver.capture('library-native-back-from-reader', 'Library', native_input)
    driver.root_fallback(driver.back())
    driver.capture('library-native-resume-after-root-back', 'Library', driver.resume())


if __name__ == '__main__':
    main()
