#!/usr/bin/env python3
"""Run declared initial or isolated prepared states in the original Compose application."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import struct
import subprocess
import time

ROOT = Path(__file__).resolve().parents[3]
MOBILE = ROOT / 'apps/mobile'
APP = 'com.slax.reader.fixture'
RUNNER = APP + '.test/com.slax.reader.fixtures.FixtureRunner'
CAPTURES = '/sdcard/Android/data/' + APP + '/files/captures'
DRIVER = Path(__file__).read_bytes()


def command(serial, *arguments, timeout=30):
    result = subprocess.run(['adb', '-s', serial, *arguments], capture_output=True, text=True, timeout=timeout)
    if result.returncode:
        raise RuntimeError(result.stderr.strip())
    return result.stdout


def capture_directories(serial):
    result = command(serial, 'shell', 'ls', '-1', CAPTURES)
    return {name for name in result.splitlines() if re.fullmatch(r'[a-z0-9-]+-[a-f0-9-]{36}', name)}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--device', required=True, choices=['emulator-5560'])
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--case', action='append')
    parser.add_argument('--action-index', type=int)
    args = parser.parse_args()
    if not args.output.is_absolute() or args.output.exists():
        raise RuntimeError('Use a fresh absolute owned output directory')
    if command(args.device, 'shell', 'getprop', 'ro.kernel.qemu').strip() != '1' or command(args.device, 'emu', 'avd', 'name').splitlines()[0] != 'slax-migration-controlled':
        raise RuntimeError('Only the explicitly allocated original controlled AVD is supported')
    scenarios = json.loads((MOBILE / 'fixtures/scenarios.json').read_text())['scenarios']
    if args.case and any(name not in scenarios for name in args.case):
        raise RuntimeError('Only closed declared fixture cases are supported')
    if args.action_index is not None and (not args.case or len(args.case) != 1 or args.action_index not in range(len(scenarios[args.case[0]]['actions']))):
        raise RuntimeError('An isolated action index requires one declared case and a valid action')
    args.output.mkdir()
    (args.output / 'executed-driver.py').write_bytes(DRIVER)
    records = []

    def save():
        (args.output / 'batch.json').write_text(json.dumps({'kind': 'original-source-native-initial-batch' if args.action_index is None else 'original-source-native-prepared-action-batch', 'schemaVersion': 1, 'appId': APP, 'testRunner': RUNNER,
            'device': args.device, 'driverSha256': hashlib.sha256(DRIVER).hexdigest(), 'records': records, 'sourceParity': 'unverified',
            'limitations': ['Each original route is launched fresh with unchanged source screen code and shared synthetic inputs.', 'Initial-only captures execute no declared preparation action; isolated action captures execute only their recorded action index.', 'Compose control/DOM preparation is not a native touch/gesture acceptance record.', 'Native foreground checks and PNG capture do not replace visual/state inspection or target matching.']}, indent=2) + '\n')

    for name in args.case or scenarios.keys():
        scenario = scenarios[name]
        directory = args.output / name
        directory.mkdir()
        record = {'name': name, 'route': scenario['route']['name'], 'initialOnly': args.action_index is None, 'isolatedActionIndex': args.action_index, 'nativeInteractionVerified': False, 'visualInspection': 'pending', 'sourceParity': 'unverified'}
        if scenario['route']['name'] not in ['Library', 'Reader', 'Settings', 'Feedback', 'About', 'Login', 'DeleteAccount'] or scenario['payload'].get('upgrade'):
            record.update(result='unsupported', reason='Original source capture adapter does not bind this route/state')
        else:
            before = None
            try:
                before = capture_directories(args.device)
                command(args.device, 'shell', 'am', 'broadcast', '-a', 'com.android.systemui.demo', '-e', 'command', 'clock', '-e', 'hhmm', '0941')
                started = time.time()
                selection = ['-e', 'fixtureInitialOnly', 'true'] if args.action_index is None else ['-e', 'fixtureActionIndex', str(args.action_index)]
                result = command(args.device, 'shell', 'am', 'instrument', '-w', '-e', 'class', 'com.slax.reader.fixtures.SourceReferenceFixtureTest',
                    '-e', 'fixtureCase', name, '-e', 'fixtureLocale', 'en', *selection, RUNNER, timeout=90)
                (directory / 'instrumentation.log').write_text(result)
                if 'OK (1 test)' not in result or 'FAILURES!!!' in result or 'INSTRUMENTATION_FAILED' in result:
                    raise RuntimeError('Original native instrumentation did not pass; inspect scoped instrumentation.log')
                created = capture_directories(args.device) - before
                if len(created) != 1 or not next(iter(created)).startswith(name + '-'):
                    raise RuntimeError('Exactly one new case-scoped original capture directory is required')
                source = CAPTURES + '/' + next(iter(created))
                frame = '00-initial' if args.action_index is None else f'{args.action_index + 1:02d}-{scenario["actions"][args.action_index]["kind"]}'
                for filename in [frame + '.png', frame + '.json', 'slax-fixture.json']:
                    command(args.device, 'pull', source + '/' + filename, str(directory / filename))
                metadata = json.loads((directory / (frame + '.json')).read_text())
                png = (directory / (frame + '.png')).read_bytes()
                selection_matches = metadata.get('initialOnlyRequested') is True if args.action_index is None else metadata.get('initialOnlyRequested') is False and metadata.get('isolatedActionIndex') == args.action_index
                if not metadata.get('controlledFixture') or metadata.get('scenario') != name or metadata.get('locale') != 'en' or metadata.get('fontScale') != 1 or not selection_matches:
                    raise RuntimeError('Actual original capture context differs from requested state conditions')
                expected_digest = hashlib.sha256((MOBILE / 'fixtures/scenarios.json').read_bytes()).hexdigest()
                if metadata.get('inputSha256') != expected_digest or png[:8] != b'\x89PNG\r\n\x1a\n' or struct.unpack('>II', png[16:24]) != (1080, 2400):
                    raise RuntimeError('Original native PNG or shared input hash differs')
                record.update(result='native-candidate-captured', externalCaptureDirectory=source, elapsedSeconds=round(time.time() - started, 3), fixtureInputSha256=expected_digest,
                              driverBuildSha256=metadata['actionDriverSha256'], capturedAtMillis=metadata['capturedAtMillis'])
            except Exception as error:
                record.update(result='failed', reason=str(error))
                if before is not None:
                    try:
                        created = capture_directories(args.device) - before
                        matching = [item for item in created if item.startswith(name + '-')]
                        if len(matching) == 1:
                            source = CAPTURES + '/' + matching[0]
                            available = command(args.device, 'shell', 'ls', '-1', source).splitlines()
                            rejected = [item for item in ['rejected-readiness.json', 'rejected-readiness.png', 'slax-fixture.json'] if item in available]
                            for filename in rejected:
                                command(args.device, 'pull', source + '/' + filename, str(directory / filename))
                            if 'rejected-readiness.json' in rejected:
                                diagnostic = json.loads((directory / 'rejected-readiness.json').read_text())
                                expected_digest = hashlib.sha256((MOBILE / 'fixtures/scenarios.json').read_bytes()).hexdigest()
                                if diagnostic.get('acceptedBaseline') is not False or diagnostic.get('scenario') != name or diagnostic.get('inputSha256') != expected_digest:
                                    raise RuntimeError('Rejected diagnostic identity or input digest differs')
                                record.update(rejectedDiagnostic=True, externalCaptureDirectory=source, acceptedBaseline=False)
                    except Exception as diagnostic_error:
                        record['diagnosticCollectionError'] = str(diagnostic_error)
        record['files'] = [{'path': str(path.relative_to(args.output)), 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'bytes': path.stat().st_size} for path in directory.iterdir()]
        records.append(record)
        save()
        print(json.dumps({'case': name, 'result': record['result'], 'reason': record.get('reason')}), flush=True)


if __name__ == '__main__':
    main()
