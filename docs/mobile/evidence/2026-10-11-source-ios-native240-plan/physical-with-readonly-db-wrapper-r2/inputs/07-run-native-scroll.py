#!/usr/bin/env python3
"""Prepare-only by default; a fresh Root grant allows bounded original native drags."""
import argparse
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import plistlib
import signal
import stat
import struct
import subprocess
import time
from uuid import UUID

REPO = Path(__file__).resolve().parents[5]
PLAN = Path(__file__).with_name('native-scroll-runtime-plan.json')
PREPARE = Path(__file__).with_name('prepare-native-scroll.py')
DEVICE = 'B85A7582-A0A7-4A0F-9BF0-8424330859F3'
DATA_DEVICE = '88E63005-F681-45A6-AF8D-BEFE4E27584D'
DEVICE_ROOT = Path('/Users/daguang/Library/Developer/CoreSimulator/Devices') / DEVICE
RUN_ROOT = Path('/private/tmp/slax-source-physical-native-scroll-511427d559f94e7d8b4b6a7d684cf319')
NONCE = '856734e5-2f5a-4e5a-924b-a597dfe1d45d'
SOURCE_ID = 'app.slax.reader.sourcefixture'
IDENTITIES = {SOURCE_ID, SOURCE_ID + '.controlhost', SOURCE_ID + '.control.xctrunner'}
SELECTOR = 'SourceFixtureControl/SourceFixtureNativeScrollControl/testPerformOneMeasuredOriginalReaderNativeDrag'
XCRUN = '/usr/bin/xcrun'
XCODE = '/Applications/Xcode.app/Contents/Developer/usr/bin/xcodebuild'
FLOOR, PRE_FREE, CAP, LOG_CAP = 3221225472, 3865470566, 268435456, 8388608
TOTAL, RELEASE, GRACE, RECEIPT_RESERVE = 180, 35, 4, 1048576
OBSERVER_CAP, REQUEST_CAP = 1048576, 16384
SOURCE_APP = Path('/private/tmp/slax-source-native-scroll-build-44e898c8-341b-4b07-b7d1-05be69d2b8b1/SlaxSourceFixtureApp.app')
PRODUCT_ROOT = Path('/private/tmp/slax-source-native-scroll-control-c2347154-a3a2-4ad8-bff0-d3e9cd84dd47/derived-data/Build/Products')
XCTESTRUN_NAME = 'SourceFixtureControl_iphonesimulator26.5-arm64.xctestrun'
STAGE = Path('/private/var/folders/_l/80rthvqs2251jkn7spm33_s40000gn/T/slax-reader-ui-fixture-byWKU3')
STAGE_SHA = '916255118823ed8d2764c333b4d135d0b0278b3b0edba2a38d48762ceaf2d4f3'


def require(ok, reason):
    if not ok:
        raise ValueError(reason)


def regular(path):
    require(path.is_absolute() and all(not p.is_symlink() for p in (path, *path.parents)), 'Relative/symlink input refused')
    info = path.lstat()
    require(stat.S_ISREG(info.st_mode), 'Nonregular input refused')
    return info


def sha(path):
    h = hashlib.sha256()
    with path.open('rb') as source:
        for chunk in iter(lambda: source.read(1048576), b''):
            h.update(chunk)
    return h.hexdigest()


def bound(entry):
    path = Path(entry['path']); info = regular(path)
    require(info.st_size == entry['bytes'] and sha(path) == entry['sha256'], 'Public binding changed: ' + str(path))
    return path


def safe_relative(value):
    p = Path(value)
    require(not p.is_absolute() and p.parts and all(part not in ('.', '..') for part in p.parts), 'Unsafe relative path')
    return p


def tree(root, active=False, hashes=False):
    """No sparse apparent exception; no other application's content is traversed."""
    logical = allocated = 0; entries = []
    if not root.exists():
        return {'logicalBytes': 0, 'allocatedBytes': 0, 'entries': []}
    require(not root.is_symlink(), 'Symlink tree root refused')
    allocated += root.lstat().st_blocks * 512
    def walk_error(error):
        if not (active and isinstance(error, FileNotFoundError)):
            raise error
    for directory, dirs, files in os.walk(root, followlinks=False, onerror=walk_error):
        for name in [*dirs, *files]:
            p = Path(directory) / name
            try:
                info = p.lstat()
                entry = {'relativePath': p.relative_to(root).as_posix(), 'mode': stat.S_IMODE(info.st_mode),
                         'allocatedBytes': info.st_blocks * 512, 'kind': 'directory'}
                if stat.S_ISREG(info.st_mode):
                    logical += info.st_size; entry.update(kind='regular', bytes=info.st_size)
                    if hashes: entry['sha256'] = sha(p)
                else:
                    require(stat.S_ISDIR(info.st_mode), 'Nonregular/symlink generated entry refused')
                allocated += info.st_blocks * 512; entries.append(entry)
            except FileNotFoundError:
                if not active: raise
    return {'logicalBytes': logical, 'allocatedBytes': allocated,
            'entries': sorted(entries, key=lambda e: e['relativePath'])}


def product_records(root):
    return [{k: e[k] for k in ('relativePath', 'bytes', 'mode', 'sha256')}
            for e in tree(root, hashes=True)['entries'] if e['kind'] == 'regular']


def verify_products(entries):
    expected = [{k: e[k] for k in ('relativePath', 'bytes', 'mode', 'sha256')}
                for e in entries if e['kind'] == 'regular']
    expected.sort(key=lambda e: e['relativePath'])
    require(len(expected) == 52 and product_records(PRODUCT_ROOT) == expected, 'Actual52 Products closed set changed')
    return expected


def verify_source(basis):
    expected = []
    for entry in basis['signed109AppFiles']:
        path = bound(entry); relative = path.relative_to(SOURCE_APP).as_posix()
        expected.append(dict(relativePath=relative, bytes=entry['bytes'], mode=entry['mode'], sha256=entry['sha256']))
    require(len(expected) == 109 and product_records(SOURCE_APP) == sorted(expected, key=lambda e: e['relativePath']), 'Signed109 Source app closed set changed')
    for entry in basis['retained113Inputs']:
        bound(entry)
    require(len(basis['retained113Inputs']) == 113, 'Wrong retained input closure')
    for entry in basis['currentAndCompiledFiveControlInputs']:
        bound(entry['current']); bound(entry['compiledInput'])
    require(len(basis['currentAndCompiledFiveControlInputs']) == 5, 'Wrong original five compiled control inputs')
    bound(basis['rawFramework'])


def verify_exact_runner(report):
    """Only the observed Apple FAT32 single-arm64 file and exact SDK slice are admitted."""
    entry = report['actualNativeMachOs'][2]; p = bound(entry)
    raw = p.read_bytes()
    require(len(raw) == 113616 and struct.unpack('>II', raw[:8]) == (0xcafebabe, 1), 'Not the observed single-slice Apple runner')
    require(struct.unpack('>IIIII', raw[8:28]) == (0x0100000c, 0, 16384, 97232, 14), 'Apple runner slice changed')
    part = raw[16384:]
    require(struct.unpack('<II', part[:8]) == (0xfeedfacf, 0x0100000c) and
            hashlib.sha256(part).hexdigest() == 'f65a42300d12f70f7a7918c7e21bd819a0ce055418822ed7c6ab60a50bda9b46', 'Wrong actual arm64 thin slice')
    sdk = bound(entry['sdkSource']).read_bytes()
    require(sdk[81920:81920 + 97232] == part, 'Observed Apple SDK slice differs')
    for item in report['actualNativeMachOs'][:2]:
        with bound(item).open('rb') as source:
            require(struct.unpack('<II', source.read(8)) == (0xfeedfacf, 0x0100000c), 'Host/test thin-arm64 changed')


def verify_stage():
    marker = STAGE / '.slax-ui-fixture-project.json'; regular(marker)
    require(sha(marker) == STAGE_SHA, 'Frozen current377 stage changed')
    entries = json.loads(marker.read_text())['generatedSourceDigests']
    require(len(entries) == len({e['path'] for e in entries}) == 377, 'Wrong stage closure')
    for entry in entries:
        path = STAGE / safe_relative(entry['path']); regular(path)
        require(sha(path) == entry['sha256'], 'Staged input changed')


def admission():
    regular(PLAN); plan = json.loads(PLAN.read_text())
    require(plan['kind'] == 'source-physical-native-scroll-runtime-plan' and plan['version'] == 1, 'Wrong runtime plan')
    require(plan['runRoot'] == str(RUN_ROOT) and plan['observationNonce'] == NONCE and plan['device'] == DEVICE and
            plan['sourceApp'] == str(SOURCE_APP) and plan['productRoot'] == str(PRODUCT_ROOT) and plan['selector'] == SELECTOR, 'Prepared scope cannot change')
    require(plan['limits'] == {'floorBytes': FLOOR, 'preFreeBytes': PRE_FREE, 'capBytes': CAP, 'logCapBytes': LOG_CAP,
                             'totalSeconds': TOTAL, 'releaseSeconds': RELEASE, 'terminationGraceSeconds': GRACE,
                             'observerSeconds': 90, 'preparationSeconds': 30, 'liveSeconds': 60,
                             'maximumGestureIndices': 3, 'oneTestSeconds': 25, 'receiptReserveBytes': RECEIPT_RESERVE}, 'Prepared limits cannot change')
    for entry in plan['bindings']: bound(entry)
    recovery = json.loads(bound(plan['recoveryReport']).read_text())
    basis = json.loads(bound(recovery['retainedBasisVerification']).read_text())
    products = json.loads(bound(recovery['compiledProducts']).read_text())
    require(products['root'] == str(PRODUCT_ROOT) and products['regularFiles'] == 52 and products['symlinks'] == [], 'Invalid actual Products')
    entries = verify_products(products['entries']); verify_source(basis); verify_exact_runner(recovery); verify_stage()
    original = plistlib.loads(bound(recovery['actualXctestrun']).read_bytes())
    require(set(original) == {'SourceFixtureControl', '__xctestrun_metadata__'} and
            original['__xctestrun_metadata__']['FormatVersion'] == 1 and
            original['SourceFixtureControl']['TestHostBundleIdentifier'] == SOURCE_ID + '.control.xctrunner' and
            original['SourceFixtureControl']['UITargetAppPath'] == '__TESTROOT__/Debug-iphonesimulator/ControlHost.app', 'Wrong actualv1 helper binding')
    require(not RUN_ROOT.exists() and not RUN_ROOT.is_symlink(), 'One attempt cannot reuse its root')
    for udid in (DEVICE, DATA_DEVICE):
        p = DEVICE_ROOT.parent / udid / 'device.plist'; regular(p); device = plistlib.loads(p.read_bytes())
        require(device['UDID'] == udid and device['state'] == 1, 'Migration owned device must be Shutdown')
        if udid == DEVICE:
            require(device['name'] == plan['deviceName'] and device['runtime'] == plan['runtime'] and device['deviceType'] == plan['deviceType'], 'Wrong owned B85 identity')
    return plan, recovery, basis, entries, original


def allocation(path, digest, plan):
    require(path == Path(plan['allocationPath']) and len(digest) == 64, 'Exact fresh Root allocation required')
    bound({'path': str(path), 'bytes': regular(path).st_size, 'sha256': digest}); grant = json.loads(path.read_text())
    expected = {'kind': 'root-one-source-physical-native-scroll-allocation', 'version': 1,
                'executorSHA256': sha(Path(__file__)), 'planSHA256': sha(PLAN), 'runRoot': str(RUN_ROOT),
                'device': DEVICE, 'observationNonce': NONCE, 'onlyTestIdentifier': SELECTOR, 'attempts': 1,
                'maximumGestureIndices': 3, 'exclusiveDeviceLoan': True, 'allOtherNativeLoansReleased': True}
    require(all(grant.get(k) == v for k, v in expected.items()), 'Allocation scope changed')
    require(type(grant.get('expiresAtUnixSeconds')) in (int, float) and time.time() < grant['expiresAtUnixSeconds'], 'Expired allocation')
    return grant


def registry():
    """Only direct container names/identity metadata; never another app's subtree or AppGroups."""
    result = {}
    for kind in ('Bundle', 'Data'):
        base = DEVICE_ROOT / 'data/Containers' / kind / 'Application'
        if not base.exists(): continue
        require(not base.is_symlink(), 'Symlink registry refused')
        for path in base.iterdir():
            require(path.is_dir() and not path.is_symlink(), 'Non-directory registry entry')
            metadata = path / '.com.apple.mobile_container_manager.metadata.plist'; identity = None
            if metadata.exists():
                require(regular(metadata).st_size <= 65536, 'Oversize identity metadata')
                identity = plistlib.loads(metadata.read_bytes()).get('MCMMetadataIdentifier')
            result[str(path)] = identity
    return result


def owned_containers(baseline, active=False):
    current = registry(); entries = []
    for name, identity in current.items():
        if identity in IDENTITIES or (active and name not in baseline and identity is None):
            info = tree(Path(name), active)
            entries.append({'path': name, 'identity': identity, 'logicalBytes': info['logicalBytes'], 'allocatedBytes': info['allocatedBytes']})
        elif name not in baseline:
            require(False, 'Unexpected new non-source/helper container')
        else:
            require(identity == baseline[name], 'Other pre-existing identity metadata changed')
    return {'containers': entries, 'logicalBytes': sum(e['logicalBytes'] for e in entries),
            'allocatedBytes': sum(e['allocatedBytes'] for e in entries)}


def free_bytes():
    v = os.statvfs('/private/tmp'); return v.f_bavail * v.f_frsize


def resource_guard(own, installed, free, logs, before=False):
    require(free >= (PRE_FREE if before else FLOOR), 'Global availability floor/reserve crossed')
    require(own['logicalBytes'] + installed['logicalBytes'] + RECEIPT_RESERVE <= CAP and
            own['allocatedBytes'] + installed['allocatedBytes'] + RECEIPT_RESERVE <= CAP, 'All owned copied/installed/container bytes exceed256MiB')
    require(logs <= LOG_CAP, 'Combined logs exceed8MiB')


def copy_request_plist(original, product_root, request):
    """No original product/plist mutation; the only diff is TESTROOT relocation plus one environment entry."""
    def relocate(value):
        if isinstance(value, str): return value.replace('__TESTROOT__', str(product_root))
        if isinstance(value, list): return [relocate(v) for v in value]
        if isinstance(value, dict): return {k: relocate(v) for k, v in value.items()}
        return value
    encoded = json.dumps(request, separators=(',', ':'))
    require(len(encoded.encode()) <= REQUEST_CAP and 'SLAX_SOURCE_NATIVE_SCROLL_REQUEST' not in original['SourceFixtureControl']['EnvironmentVariables'], 'Unexpected request transport')
    result = relocate(original)
    result['SourceFixtureControl']['EnvironmentVariables']['SLAX_SOURCE_NATIVE_SCROLL_REQUEST'] = encoded
    stripped = json.loads(json.dumps(result)); del stripped['SourceFixtureControl']['EnvironmentVariables']['SLAX_SOURCE_NATIVE_SCROLL_REQUEST']
    require(stripped == relocate(original), 'Unallocated copied plist diff')
    return result


def test_command(index):
    require(type(index) is int and 1 <= index <= 3, 'Only three unique physical indices')
    return [XCODE, 'test-without-building', '-xctestrun', str(RUN_ROOT / f'request-{index}.xctestrun'),
            '-destination', 'platform=iOS Simulator,id=' + DEVICE, '-parallel-testing-enabled', 'NO',
            '-maximum-concurrent-test-simulator-destinations', '1', '-jobs', '1', '-only-testing:' + SELECTOR,
            '-resultBundlePath', str(RUN_ROOT / f'request-{index}.xcresult')]


def exact_command(argv):
    sim = [XCRUN, 'simctl']
    allowed = [sim + ['list', 'devices', '--json'], sim + ['boot', DEVICE], sim + ['bootstatus', DEVICE, '-b'],
               sim + ['status_bar', DEVICE, 'override', '--time', '09:41', '--dataNetwork', 'wifi', '--wifiMode', 'active', '--wifiBars', '3', '--cellularMode', 'active', '--cellularBars', '4', '--batteryState', 'charged', '--batteryLevel', '100'],
               sim + ['ui', DEVICE, 'appearance', 'light'], sim + ['ui', DEVICE, 'content_size', 'large'],
               sim + ['install', DEVICE, str(SOURCE_APP)], sim + ['get_app_container', DEVICE, SOURCE_ID, 'data'],
               sim + ['launch', '--terminate-running-process', DEVICE, SOURCE_ID, '--scenario', 'reader-mixed', '--fixture-locale', 'en', '--fixture-action-index', '-1', '--fixture-reader-step', 'none', '--fixture-native-scroll-observation', NONCE, '-AppleLanguages', '(en)', '-AppleLocale', 'en_US'],
               sim + ['status_bar', DEVICE, 'clear'], sim + ['shutdown', DEVICE],
               *[sim + ['terminate', DEVICE, i] for i in sorted(IDENTITIES)],
               *[test_command(i) for i in range(1, 4)],
               *[[XCRUN, 'xcresulttool', 'get', 'test-results', mode, '--path', str(RUN_ROOT / f'request-{i}.xcresult')] for i in range(1, 4) for mode in ('summary', 'tests')],
               *[sim + ['io', DEVICE, 'screenshot', str(RUN_ROOT / f'{label}.png')] for label in ('initial', 'candidate', 'final')]]
    require(argv in allowed, 'Unallocated command/identity/input refused')


def observed_value(raw, prepare, nonce, identity=None, now=None):
    require(len(raw) <= OBSERVER_CAP, 'Bounded observer shape exceeded')
    value = json.loads(raw); now = time.time() if now is None else now
    require(type(value) is dict, 'Observer must be an object')
    require(value.get('observationNonce') == nonce and (identity is None or value.get('webIdentity') == identity), 'Observation nonce/actual WK identity changed')
    # Use the unchanged prepared native-request admission for all conditions/geometry.
    try:
        prepare.checked_request(value, 1, now)
    except ValueError as error:
        if str(error) != 'Already measured240; capture it without fabricating a gesture': raise
    geometry = value['samples'][-1]['geometry']
    actual = geometry.get('positionPixels')
    require(type(actual) in (int, float) and math.isfinite(actual), 'Missing actual native projection')
    for sample in value['samples'][-3:]:
        g = sample['geometry']
        def f32(number):
            return struct.unpack('<f', struct.pack('<f', number))[0]
        expected = max(f32(f32(f32(g['offsetYPoints']) + f32(g['topInsetPoints'])) * f32(value['scale'])), 0)
        require(g.get('sourceCallbackFloat32Density') == 3 and
                g.get('sourceCallbackFloat32PositionPixels') == expected, 'Separately named Float32 arithmetic projection changed')
    return value


def measured_post_input(value, before):
    require(value['nativeKvoEventCount'] > before['beforeNativeKvoEventCount'], 'No new native callback after physical input')
    later = [e for e in value['nativeKvoEvents'] if e['sequence'] > before['beforeNativeKvoEventCount'] and e['kind'] == 'native-contentOffset-KVO']
    require(later, 'No post-input contentOffset KVO')
    recent = value['samples'][-3:]
    require(all(s['observedAtUnixSeconds'] > before['observedAtUnixSeconds'] for s in recent), 'Settled samples predate input')
    require(recent[-1]['geometry']['positionPixels'] != before['beforeGeometry']['positionPixels'], 'Physical input produced no measured movement')
    geometry = recent[-1]['geometry']
    return {'rawCGFloatPositionPixels': geometry['positionPixels'],
            'sourceCallbackFloat32ProjectionPixels': geometry.get('sourceCallbackFloat32PositionPixels'),
            'rawCGFloatExact240': geometry['positionPixels'] == 240,
            'float32ArithmeticEquals240': geometry.get('sourceCallbackFloat32PositionPixels') == 240,
            'actualKotlinCallbackObserved': False, 'persistedPositionRead': False,
            'postNativeOffsetKvoCount': len(later), 'nativeGeometry': geometry, 'accepted': False}


def live_window_admission(current_elapsed, since_launch, remaining):
    # preparedAt is private in the unchanged launcher. Since it is >= began,
    # 60-currentElapsed conservatively bounds the remaining live window.
    require(type(current_elapsed) in (int, float) and math.isfinite(current_elapsed) and
            0 <= current_elapsed <= 30 and since_launch < 90, 'Insufficient conservative finite observer live window')
    require(remaining >= RELEASE + GRACE + 30, 'Insufficient native test/release time')


class Executor:
    def __init__(self, plan, recovery, basis, entries, original, grant):
        self.plan, self.recovery, self.basis, self.entries, self.original = plan, recovery, basis, entries, original
        self.started = time.monotonic(); self.baseline = registry(); self.last_sample = -1
        self.boot_issued = False; self.launched = None; self.launched_unix = None; self.data_root = None; self.identity = None; self.used = set()
        self.commands = []; self.samples = []; self.measurements = []
        installed = owned_containers(self.baseline)
        resource_guard({'logicalBytes': 0, 'allocatedBytes': 0}, installed, free_bytes(), 0, True)
        RUN_ROOT.mkdir(mode=0o700); (RUN_ROOT / 'logs').mkdir(); (RUN_ROOT / 'tmp').mkdir()
        self.receipt = {'kind': 'actual-source-physical-native-scroll-attempt', 'version': 1, 'planSHA256': sha(PLAN),
                        'executorSHA256': sha(Path(__file__)), 'allocation': grant, 'observationNonce': NONCE,
                        'device': DEVICE, 'selector': SELECTOR, 'commands': self.commands, 'resourceSamples': self.samples,
                        'measurements': self.measurements, 'initialGlobalAvailableBytes': free_bytes(),
                        'wholeB85AllocatedGrowthVerified': False, 'actualKotlinCallbackObserved': False,
                        'persistedPositionRead': False, 'native240Accepted': False, 'visualParityAccepted': False}
        spec = importlib.util.spec_from_file_location('bound_original_prepare', PREPARE)
        self.prepare = importlib.util.module_from_spec(spec); spec.loader.exec_module(self.prepare)
        self.save()

    def remaining(self):
        return TOTAL - (time.monotonic() - self.started)

    def save(self):
        data = (json.dumps(self.receipt, indent=2) + '\n').encode()
        require(len(data) <= RECEIPT_RESERVE, 'Receipt reserve exceeded')
        p = RUN_ROOT / 'receipt.json.tmp'; p.write_bytes(data); p.replace(RUN_ROOT / 'receipt.json')

    def resources(self, active=True):
        own = tree(RUN_ROOT, active); installed = owned_containers(self.baseline, active)
        logs = sum(p.stat().st_size for p in (RUN_ROOT / 'logs').iterdir() if p.is_file())
        free = free_bytes(); resource_guard(own, installed, free, logs)
        elapsed = time.monotonic() - self.started
        if elapsed - self.last_sample >= 0.5 or not active:
            require(len(self.samples) < 512, 'Bounded resource sampler exhausted')
            self.samples.append({'elapsedSeconds': elapsed, 'globalAvailableBytes': free,
                                 'ownLogicalBytes': own['logicalBytes'], 'ownAllocatedBytes': own['allocatedBytes'],
                                 'installedLogicalBytes': installed['logicalBytes'], 'installedAllocatedBytes': installed['allocatedBytes'], 'logBytes': logs})
            self.last_sample = elapsed
        return installed

    def stop(self, p):
        if p.poll() is not None: return
        require(os.getpgid(p.pid) == p.pid, 'Refuse to stop a nonowned process group')
        os.killpg(p.pid, signal.SIGTERM)
        try: p.wait(timeout=min(GRACE, max(0.1, self.remaining())))
        except subprocess.TimeoutExpired:
            os.killpg(p.pid, signal.SIGKILL); p.wait(timeout=2)

    def command(self, argv, seconds, release=False):
        exact_command(argv)
        budget = min(seconds, self.remaining() - GRACE - (0 if release else RELEASE))
        require(budget > 0, 'No command/release reserve remains')
        index = len(self.commands); out = RUN_ROOT / f'logs/{index:02d}.stdout'; err = RUN_ROOT / f'logs/{index:02d}.stderr'
        record = {'argv': argv, 'timeoutSeconds': budget, 'exitCode': None, 'stopped': None,
                  'stdout': str(out), 'stderr': str(err)}
        self.commands.append(record); self.save(); began = time.monotonic(); p = None
        env = {'PATH': '/usr/bin:/bin:/usr/sbin:/sbin', 'DEVELOPER_DIR': '/Applications/Xcode.app/Contents/Developer', 'TMPDIR': str(RUN_ROOT / 'tmp')}
        for k in ('HOME', 'USER', 'LOGNAME'):
            if k in os.environ: env[k] = os.environ[k]
        try:
            if not release: self.resources()
            with out.open('wb') as o, err.open('wb') as e:
                p = subprocess.Popen(argv, stdout=o, stderr=e, cwd=RUN_ROOT, env=env, start_new_session=True)
                record['ownedPID'] = p.pid
                while p.poll() is None:
                    require(time.monotonic() - began < budget, 'Owned command deadline exceeded')
                    if release:
                        require(sum(v.stat().st_size for v in (RUN_ROOT / 'logs').iterdir() if v.is_file()) <= LOG_CAP, 'Release log cap crossed')
                    else: self.resources()
                    time.sleep(0.5)
                record['exitCode'] = p.returncode
            if not release: self.resources()
        except Exception as error:
            record['stopped'] = type(error).__name__ + ': ' + str(error)
            if p is not None and p.poll() is None: self.stop(p); record['exitCode'] = p.returncode
            raise
        finally:
            record['elapsedSeconds'] = time.monotonic() - began
            for k, path in [('stdoutSHA256', out), ('stderrSHA256', err)]:
                if path.exists(): record[k] = sha(path)
            self.save()
        require(record['exitCode'] == 0 or release, 'Allocated command exited nonzero')
        return out

    def device_list(self, path, shutdown):
        data = json.loads(path.read_text()); all_devices = [d for v in data['devices'].values() for d in v]
        ours = [d for d in all_devices if d['udid'] == DEVICE]
        require(len(ours) == 1 and ours[0]['state'] == ('Shutdown' if shutdown else 'Booted') and
                ours[0]['name'] == self.plan['deviceName'], 'Owned B85 identity/state changed')
        other_owned = [d for d in all_devices if d['udid'] == DATA_DEVICE]
        require(len(other_owned) == 1 and other_owned[0]['state'] == 'Shutdown', 'Owned DATA88 loan is still live')
        self.receipt['readonlyOtherSimulatorStates'] = [{k: d.get(k) for k in ('udid', 'name', 'state')} for d in all_devices if d['udid'] not in (DEVICE, DATA_DEVICE)]

    def copy_products(self):
        root = RUN_ROOT / 'Products'; root.mkdir()
        for entry in self.entries:
            self.resources(); require(self.remaining() > RELEASE, 'Copy consumes release reserve')
            src = PRODUCT_ROOT / safe_relative(entry['relativePath']); dst = root / safe_relative(entry['relativePath'])
            dst.parent.mkdir(parents=True, exist_ok=True)
            with src.open('rb') as s, dst.open('xb') as d:
                for chunk in iter(lambda: s.read(1048576), b''): d.write(chunk)
            dst.chmod(entry['mode'])
        require(product_records(root) == self.entries, 'Copied52 Product bytes/modes changed')

    def observation(self):
        require(self.data_root is not None, 'Source data container unavailable')
        path = self.data_root / 'Library/Application Support/fixture-native-reader-observation.json'
        info = regular(path); require(info.st_size <= OBSERVER_CAP, 'Oversize source observer')
        require(info.st_mtime >= self.launched_unix, 'Observer predates the one current launch')
        raw = path.read_bytes()
        value = observed_value(raw, self.prepare, NONCE, self.identity)
        if self.identity is None: self.identity = value['webIdentity']
        return raw, value

    def wait_observation(self, until, before=None):
        last = None
        while time.monotonic() < until and self.remaining() > RELEASE + GRACE:
            self.resources()
            try:
                raw, value = self.observation()
                if before is not None: measured_post_input(value, before)
                return raw, value
            except (FileNotFoundError, ValueError, json.JSONDecodeError) as error:
                last = str(error)
                # Unknown terminal/nonce changes are refused, never restarted.
                path = self.data_root / 'Library/Application Support/fixture-native-reader-observation.json'
                if path.exists() and not path.is_symlink():
                    data = path.read_bytes()
                    if len(data) <= OBSERVER_CAP:
                        try:
                            state = json.loads(data)
                            if state.get('observationNonce') == NONCE:
                                require(state.get('state') == 'observing', 'Current observer became terminal')
                            elif self.identity is not None:
                                require(False, 'Bound observer nonce changed')
                        except json.JSONDecodeError: pass
            time.sleep(0.5)
        raise ValueError('Fresh settled source observation unavailable: ' + str(last))

    def keep_observation(self, label, raw):
        path = RUN_ROOT / label / 'fixture-native-reader-observation.json'; path.parent.mkdir()
        with path.open('xb') as f: f.write(raw)
        self.resources(); return {'path': str(path), 'bytes': len(raw), 'sha256': sha(path)}

    def one_gesture(self, index, raw, value):
        require(index not in self.used and 1 <= index <= 3, 'Unique physical input index required')
        current_elapsed = value['samples'][-1]['elapsedSeconds']
        live_window_admission(current_elapsed, time.monotonic() - self.launched, self.remaining())
        request = self.prepare.checked_request(value, index)
        request['actualObservationSha256'] = hashlib.sha256(raw).hexdigest()
        self.keep_observation(f'before-{index}', raw)
        encoded = (json.dumps(request, indent=2) + '\n').encode(); require(len(encoded) <= REQUEST_CAP, 'Oversize physical request')
        p = RUN_ROOT / f'request-{index}.json'; p.write_bytes(encoded)
        copied = copy_request_plist(self.original, RUN_ROOT / 'Products', request)
        xctest = RUN_ROOT / f'request-{index}.xctestrun'; xctest.write_bytes(plistlib.dumps(copied, sort_keys=False))
        self.resources(); self.used.add(index)
        self.command(test_command(index), 25)
        info = RUN_ROOT / f'request-{index}.xcresult/Info.plist'; regular(info)
        completed = plistlib.loads(info.read_bytes()); require(completed.get('rootId') and completed.get('version'), 'Incomplete actual xcresult metadata')
        summary_path = self.command([XCRUN, 'xcresulttool', 'get', 'test-results', 'summary', '--path', str(RUN_ROOT / f'request-{index}.xcresult')], 5)
        summary = json.loads(summary_path.read_text())
        require(all(summary.get(k) == v for k, v in {'totalTestCount': 1, 'passedTests': 1, 'failedTests': 0, 'skippedTests': 0, 'expectedFailures': 0, 'result': 'Passed'}.items()), 'Actual native test is not one-pass/no-skip')
        configs = summary.get('devicesAndConfigurations', [])
        require(len(configs) == 1 and configs[0]['device']['deviceId'] == DEVICE and configs[0]['device']['architecture'] == 'arm64', 'Actual native test used another device/architecture')
        tests_path = self.command([XCRUN, 'xcresulttool', 'get', 'test-results', 'tests', '--path', str(RUN_ROOT / f'request-{index}.xcresult')], 5)
        post_raw, post_value = self.wait_observation(min(time.monotonic() + 5, self.launched + 85), request)
        measured = measured_post_input(post_value, request)
        measured.update(gestureIndex=index, requestSHA256=sha(p), copiedXctestrunSHA256=sha(xctest),
                        beforeObservationSHA256=hashlib.sha256(raw).hexdigest(),
                        afterObservation=self.keep_observation(f'after-{index}', post_raw),
                        rawSummary={'path': str(summary_path), 'sha256': sha(summary_path)},
                        rawTests={'path': str(tests_path), 'sha256': sha(tests_path)},
                        completedInfoSHA256=sha(info))
        self.measurements.append(measured); self.save()
        return post_raw, post_value, measured

    def run(self):
        failure = None
        try:
            self.device_list(self.command([XCRUN, 'simctl', 'list', 'devices', '--json'], 10), True)
            self.copy_products(); self.boot_issued = True
            self.command([XCRUN, 'simctl', 'boot', DEVICE], 15)
            self.command([XCRUN, 'simctl', 'bootstatus', DEVICE, '-b'], 45)
            self.command([XCRUN, 'simctl', 'status_bar', DEVICE, 'override', '--time', '09:41', '--dataNetwork', 'wifi', '--wifiMode', 'active', '--wifiBars', '3', '--cellularMode', 'active', '--cellularBars', '4', '--batteryState', 'charged', '--batteryLevel', '100'], 10)
            self.command([XCRUN, 'simctl', 'ui', DEVICE, 'appearance', 'light'], 10)
            self.command([XCRUN, 'simctl', 'ui', DEVICE, 'content_size', 'large'], 10)
            verify_source(self.basis); self.command([XCRUN, 'simctl', 'install', DEVICE, str(SOURCE_APP)], 20)
            container = self.command([XCRUN, 'simctl', 'get_app_container', DEVICE, SOURCE_ID, 'data'], 10).read_text().strip()
            path = Path(container); base = DEVICE_ROOT / 'data/Containers/Data/Application'
            require(path.is_absolute() and path.parent == base and not path.is_symlink() and path.is_dir(), 'Not exact source-only Data container')
            require(registry().get(str(path)) == SOURCE_ID, 'Source Data identity mismatch')
            self.data_root = path; self.receipt['sourceDataContainer'] = str(path)
            require(self.remaining() >= 125, 'Cannot launch finite90s observer plus35s release')
            resource_guard(tree(RUN_ROOT), owned_containers(self.baseline), free_bytes(), 0, True)
            self.launched = time.monotonic(); self.launched_unix = time.time()
            self.command([XCRUN, 'simctl', 'launch', '--terminate-running-process', DEVICE, SOURCE_ID, '--scenario', 'reader-mixed', '--fixture-locale', 'en', '--fixture-action-index', '-1', '--fixture-reader-step', 'none', '--fixture-native-scroll-observation', NONCE, '-AppleLanguages', '(en)', '-AppleLocale', 'en_US'], 10)
            raw, value = self.wait_observation(self.launched + 30)
            self.receipt['initialObservation'] = self.keep_observation('initial', raw)
            self.command([XCRUN, 'simctl', 'io', DEVICE, 'screenshot', str(RUN_ROOT / 'initial.png')], 10)
            for index in range(1, 4):
                raw, value = self.wait_observation(min(self.launched + 85, time.monotonic() + 5))
                g = value['samples'][-1]['geometry']
                if g['positionPixels'] == 240:
                    self.receipt['candidateRawCGFloatExact240'] = True
                    self.keep_observation('candidate', raw); break
                raw, value, measured = self.one_gesture(index, raw, value)
                if measured['rawCGFloatExact240'] or measured['float32ArithmeticEquals240']:
                    self.receipt['candidateRawCGFloatExact240'] = measured['rawCGFloatExact240']
                    self.receipt['candidateFloat32ArithmeticEquals240'] = measured['float32ArithmeticEquals240']
                    self.keep_observation('candidate', raw); break
            self.command([XCRUN, 'simctl', 'io', DEVICE, 'screenshot', str(RUN_ROOT / 'candidate.png')], 10)
            self.receipt['physicalRequestsIssued'] = sorted(self.used)
            self.receipt['sourceCallbackAndPersistedResultRequireSeparateProof'] = True
        except Exception as error:
            failure = type(error).__name__ + ': ' + str(error); self.receipt['refusal'] = failure
        finally:
            if self.data_root is not None:
                try:
                    current = self.data_root / 'Library/Application Support/fixture-native-reader-observation.json'
                    require(regular(current).st_size <= OBSERVER_CAP, 'Oversize final observer')
                    self.keep_observation('latest-before-release', current.read_bytes())
                except Exception as error: self.receipt['latestObservationPreservationFailure'] = str(error)
            if self.boot_issued:
                for identity in sorted(IDENTITIES):
                    try: self.command([XCRUN, 'simctl', 'terminate', DEVICE, identity], 4, True)
                    except Exception as error: self.receipt.setdefault('releaseFailures', []).append(str(error))
                for argv, timeout in [([XCRUN, 'simctl', 'status_bar', DEVICE, 'clear'], 4), ([XCRUN, 'simctl', 'shutdown', DEVICE], 10)]:
                    try: self.command(argv, timeout, True)
                    except Exception as error: self.receipt.setdefault('releaseFailures', []).append(str(error))
                try:
                    self.device_list(self.command([XCRUN, 'simctl', 'list', 'devices', '--json'], 4, True), True)
                    self.receipt['ownedDeviceShutdownReadback'] = True
                except Exception as error: self.receipt.setdefault('releaseFailures', []).append(str(error))
            try:
                verify_products([dict(e, kind='regular') for e in self.entries]); verify_source(self.basis); verify_stage()
                self.receipt['protectedAppProductsAndStageUnchanged'] = True
                installed = self.resources(False)
                self.receipt['finalOwnedContainers'] = installed['containers']
                # The final receipt contains this manifest; exclude that one
                # self-referential file rather than binding its previous bytes.
                self.receipt['newRunFilesExcludingReceipt'] = [e for e in product_records(RUN_ROOT) if e['relativePath'] != 'receipt.json']
                self.receipt['copiedOriginalProductsUnchanged'] = product_records(RUN_ROOT / 'Products') == self.entries
                require(self.receipt['copiedOriginalProductsUnchanged'], 'Copied original Products changed')
            except Exception as error:
                self.receipt['protectedOrResourceFailure'] = str(error); failure = failure or str(error)
            self.receipt['elapsedSeconds'] = time.monotonic() - self.started
            self.receipt['finalGlobalAvailableBytes'] = free_bytes()
            self.receipt['globalAvailabilityDeltaBytes'] = self.receipt['finalGlobalAvailableBytes'] - self.receipt['initialGlobalAvailableBytes']
            if self.receipt['elapsedSeconds'] > TOTAL: failure = failure or 'Total180-second window exceeded'
            self.receipt['status'] = 'raw-original-native-scroll-awaiting-independent-review' if not failure and not self.receipt.get('releaseFailures') else 'stopped-or-release-unconfirmed'
            self.save()
        return 0 if self.receipt['status'] == 'raw-original-native-scroll-awaiting-independent-review' else 1


def main():
    parser = argparse.ArgumentParser(); parser.add_argument('--execute', action='store_true')
    parser.add_argument('--allocation', type=Path); parser.add_argument('--allocation-sha256')
    args = parser.parse_args(); plan, recovery, basis, entries, original = admission()
    if not args.execute:
        require(args.allocation is None and args.allocation_sha256 is None, 'Readonly mode does not take a grant')
        print(json.dumps({'status': 'readonly-preparation-pass', 'compiledProducts': 52, 'signedSourceFiles': 109,
                          'observedRunner': 'exactAppleFAT32-single-arm64', 'nativeExecuted': False, 'runRootCreated': False})); return 0
    require(args.allocation is not None and args.allocation_sha256 is not None, 'Fresh Root allocation required')
    grant = allocation(args.allocation, args.allocation_sha256, plan)
    return Executor(plan, recovery, basis, entries, original, grant).run()


if __name__ == '__main__':
    try: raise SystemExit(main())
    except (ValueError, OSError, KeyError, json.JSONDecodeError, plistlib.InvalidFileException) as error:
        print(json.dumps({'status': 'refused-before-or-outside-native', 'reason': str(error)})); raise SystemExit(1)
