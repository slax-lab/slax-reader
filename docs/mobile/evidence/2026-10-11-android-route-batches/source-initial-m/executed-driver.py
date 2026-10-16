#!/usr/bin/env python3
"""Run only declared initial states through the isolated original Compose application."""
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
    args = parser.parse_args()
    if not args.output.is_absolute() or args.output.exists():
        raise RuntimeError('Use a fresh absolute owned output directory')
    if command(args.device, 'shell', 'getprop', 'ro.kernel.qemu').strip() != '1' or command(args.device, 'emu', 'avd', 'name').splitlines()[0] != 'slax-migration-controlled':
        raise RuntimeError('Only the explicitly allocated original controlled AVD is supported')
    scenarios = json.loads((MOBILE / 'fixtures/scenarios.json').read_text())['scenarios']
    if args.case and any(name not in scenarios for name in args.case):
        raise RuntimeError('Only closed declared fixture cases are supported')
    args.output.mkdir()
    (args.output / 'executed-driver.py').write_bytes(DRIVER)
    records = []

    def save():
        (args.output / 'batch.json').write_text(json.dumps({'kind': 'original-source-native-initial-batch', 'schemaVersion': 1, 'appId': APP, 'testRunner': RUNNER,
            'device': args.device, 'driverSha256': hashlib.sha256(DRIVER).hexdigest(), 'records': records, 'sourceParity': 'unverified',
            'limitations': ['Each original route is launched fresh with unchanged source screen code and shared synthetic inputs.', 'Initial-only captures execute no declared preparation action.', 'Native foreground checks and PNG capture do not replace visual/state inspection or target matching.']}, indent=2) + '\n')

    for name in args.case or scenarios.keys():
        scenario = scenarios[name]
        directory = args.output / name
        directory.mkdir()
        record = {'name': name, 'route': scenario['route']['name'], 'initialOnly': True, 'nativeInteractionVerified': False, 'visualInspection': 'pending', 'sourceParity': 'unverified'}
        if scenario['route']['name'] not in ['Library', 'Reader', 'Settings', 'Feedback', 'About', 'Login'] or scenario['payload'].get('upgrade'):
            record.update(result='unsupported', reason='Original source capture adapter does not bind this route/state')
        else:
            try:
                before = capture_directories(args.device)
                command(args.device, 'shell', 'am', 'broadcast', '-a', 'com.android.systemui.demo', '-e', 'command', 'clock', '-e', 'hhmm', '0941')
                started = time.time()
                result = command(args.device, 'shell', 'am', 'instrument', '-w', '-e', 'class', 'com.slax.reader.fixtures.SourceReferenceFixtureTest',
                    '-e', 'fixtureCase', name, '-e', 'fixtureLocale', 'en', '-e', 'fixtureInitialOnly', 'true', RUNNER, timeout=90)
                (directory / 'instrumentation.log').write_text(result)
                if 'OK (1 test)' not in result or 'FAILURES!!!' in result or 'INSTRUMENTATION_FAILED' in result:
                    raise RuntimeError('Original native instrumentation did not pass; inspect scoped instrumentation.log')
                created = capture_directories(args.device) - before
                if len(created) != 1 or not next(iter(created)).startswith(name + '-'):
                    raise RuntimeError('Exactly one new case-scoped original capture directory is required')
                source = CAPTURES + '/' + next(iter(created))
                for filename in ['00-initial.png', '00-initial.json', 'slax-fixture.json']:
                    command(args.device, 'pull', source + '/' + filename, str(directory / filename))
                metadata = json.loads((directory / '00-initial.json').read_text())
                png = (directory / '00-initial.png').read_bytes()
                if not metadata.get('controlledFixture') or metadata.get('scenario') != name or metadata.get('locale') != 'en' or metadata.get('fontScale') != 1 or metadata.get('initialOnlyRequested') is not True:
                    raise RuntimeError('Actual original capture context differs from requested initial conditions')
                expected_digest = hashlib.sha256((MOBILE / 'fixtures/scenarios.json').read_bytes()).hexdigest()
                if metadata.get('inputSha256') != expected_digest or png[:8] != b'\x89PNG\r\n\x1a\n' or struct.unpack('>II', png[16:24]) != (1080, 2400):
                    raise RuntimeError('Original native PNG or shared input hash differs')
                record.update(result='native-candidate-captured', externalCaptureDirectory=source, elapsedSeconds=round(time.time() - started, 3), fixtureInputSha256=expected_digest,
                              driverBuildSha256=metadata['actionDriverSha256'], capturedAtMillis=metadata['capturedAtMillis'])
            except Exception as error:
                record.update(result='failed', reason=str(error))
        record['files'] = [{'path': str(path.relative_to(args.output)), 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'bytes': path.stat().st_size} for path in directory.iterdir()]
        records.append(record)
        save()
        print(json.dumps({'case': name, 'result': record['result'], 'reason': record.get('reason')}), flush=True)


if __name__ == '__main__':
    main()
