#!/usr/bin/env python3
"""Read-only by default. A fresh Root grant permits one archived-bitmap XCTest only."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import plistlib
import signal
import stat
import subprocess
import time

REPO = Path(__file__).resolve().parents[7]
EVIDENCE = REPO / 'retired-evidence'
BASE_PLAN = EVIDENCE / 'cross-paragraph-native-bitmap-only-plan-r2/plan.json'
BASE_SHA = '540ec48c9d0cfc5e52d7c814be8f05f671b1abf7654f1163a65ec4e5fa90503a'
POLICY = Path(__file__).with_name('bitmap-runtime-policy-r3.json')
DEVICE = 'B85A7582-A0A7-4A0F-9BF0-8424330859F3'
OWNED_DEVICES = [DEVICE, '88E63005-F681-45A6-AF8D-BEFE4E27584D']
DEVICE_ROOT = Path('/Users/daguang/Library/Developer/CoreSimulator/Devices') / DEVICE
RUN_ROOT = Path('/private/tmp/slax-reader-cross-bitmap-run-0076bd11ce2242fe920dbba736f5e29f')
STAGE = Path('/private/var/folders/_l/80rthvqs2251jkn7spm33_s40000gn/T/slax-reader-ui-fixture-byWKU3')
STAGE_SHA = '916255118823ed8d2764c333b4d135d0b0278b3b0edba2a38d48762ceaf2d4f3'
SELECTOR = 'CrossParagraphControl/ReaderCrossParagraphBitmapPreflight/testArchivedNativeSelectionHandlesBitmapOrientation'
IDENTITIES = {'app.slax.reader.crossparagraphfixture.controlhost', 'app.slax.reader.crossparagraphfixture.control.xctrunner'}
XCRUN = '/usr/bin/xcrun'
XCODE = '/Applications/Xcode.app/Contents/Developer/usr/bin/xcodebuild'
FLOOR, PRE_FREE, CAP, LOG_CAP = 3221225472, 3865470566, 134217728, 8388608
TOTAL, TEST_TIMEOUT, RELEASE_RESERVE, GRACE = 120, 45, 30, 4
RECEIPT_RESERVE = 1048576


def require(condition, message):
    if not condition:
        raise ValueError(message)


def regular(path):
    require(path.is_absolute() and all(not p.is_symlink() for p in (path, *path.parents)), 'Symlink or relative input refused')
    value = path.lstat()
    require(stat.S_ISREG(value.st_mode), 'Nonregular input refused')
    return value


def sha(path):
    h = hashlib.sha256()
    with path.open('rb') as source:
        for chunk in iter(lambda: source.read(1048576), b''):
            h.update(chunk)
    return h.hexdigest()


def bound(entry):
    path = Path(entry['path']); value = regular(path)
    require(value.st_size == entry['bytes'] and sha(path) == entry['sha256'], 'Public binding changed: ' + str(path))
    return path


def safe_relative(value):
    path = Path(value)
    require(not path.is_absolute() and bool(path.parts) and all(p not in ('..', '.') for p in path.parts), 'Unsafe relative product path')
    return path


def tree(root, active=False):
    """No apparent-size exception. Only disappearing active-generated entries may race."""
    logical = allocated = count = 0
    if not root.exists():
        return {'logicalBytes': 0, 'allocatedBytes': 0, 'regularFiles': 0}
    require(not root.is_symlink(), 'Symlink tree root refused')
    allocated += root.lstat().st_blocks * 512
    def walk_error(error):
        if not (active and isinstance(error, FileNotFoundError)):
            raise error
    for directory, dirs, files in os.walk(root, followlinks=False, onerror=walk_error):
        for name in [*dirs, *files]:
            path = Path(directory) / name
            try:
                value = path.lstat()
            except FileNotFoundError:
                if active:
                    continue
                raise
            allocated += value.st_blocks * 512
            if stat.S_ISREG(value.st_mode):
                logical += value.st_size; count += 1
            else:
                require(stat.S_ISDIR(value.st_mode), 'Nonregular/symlink runtime entry refused')
    return {'logicalBytes': logical, 'allocatedBytes': allocated, 'regularFiles': count}


def product_records(root):
    records = []
    tree(root)
    for directory, _, files in os.walk(root, followlinks=False):
        for name in files:
            path = Path(directory) / name; value = regular(path)
            records.append({'relativePath': path.relative_to(root).as_posix(), 'bytes': value.st_size,
                            'mode': stat.S_IMODE(value.st_mode), 'sha256': sha(path)})
    return sorted(records, key=lambda e: e['relativePath'])


def verify_products(root, entries):
    expected = [{key: entry[key] for key in ('relativePath', 'bytes', 'mode', 'sha256')} for entry in entries]
    require(product_records(root) == expected and len(entries) == 53 and len({e['relativePath'] for e in entries}) == 53, 'Compiled Products closed set changed')


def verify_stage():
    marker = STAGE / '.slax-ui-fixture-project.json'
    require(sha(bound({'path': str(marker), 'bytes': regular(marker).st_size, 'sha256': STAGE_SHA})) == STAGE_SHA, 'Stage marker changed')
    data = json.loads(marker.read_text())
    entries = data['generatedSourceDigests']
    require(len(entries) == 377 and len({e['path'] for e in entries}) == 377, 'Wrong frozen stage closure')
    for entry in entries:
        path = STAGE / safe_relative(entry['path']); regular(path)
        require(sha(path) == entry['sha256'], 'Frozen staged input changed')
    return {'markerSHA256': STAGE_SHA, 'generatedSourceFiles': len(entries)}


def admission():
    require(sha(bound({'path': str(BASE_PLAN), 'bytes': regular(BASE_PLAN).st_size, 'sha256': BASE_SHA})) == BASE_SHA, 'Frozen plan changed')
    plan = json.loads(BASE_PLAN.read_text()); regular(POLICY); policy = json.loads(POLICY.read_text())
    require(plan['runRoot'] == str(RUN_ROOT) and plan['device']['UDID'] == DEVICE and plan['onlyTestIdentifier'] == SELECTOR, 'Wrong prepared scope')
    require(policy['kind'] == 'cross-paragraph-bitmap-only-runtime-policy' and policy['version'] == 3, 'Wrong runtime policy')
    require(policy['basePlanSHA256'] == BASE_SHA and policy['runRoot'] == str(RUN_ROOT), 'Wrong policy basis')
    require(policy['limits'] == {'preFreeBytes': PRE_FREE, 'floorBytes': FLOOR, 'allDistinctNewLogicalAndAllocatedCapBytes': CAP,
                                'combinedLogCapBytes': LOG_CAP, 'totalWindowSeconds': TOTAL, 'nativeTestTimeoutSeconds': TEST_TIMEOUT,
                                'releaseReserveSeconds': RELEASE_RESERVE, 'receiptReserveBytes': RECEIPT_RESERVE}, 'Limits cannot change')
    require(len(policy['publicInputs']) == 4 and {entry['path'] for entry in policy['publicInputs']} ==
            {str(Path(__file__)), str(Path(__file__).with_name('bitmap-runtime-guards-r3.test.py')), XCRUN, XCODE}, 'Runtime public input paths must be the exact closed set')
    for entry in policy['publicInputs']:
        bound(entry)
    for entry in [plan['actualCompiledBasis']['receipt'], plan['actualCompiledBasis']['originalXctestrun'],
                  plan['actualCompiledBasis']['rootActualBuildReview'], plan['actualCompiledBasis']['productManifest'],
                  plan['device']['lastOwnedRelease'], *plan['publicSourceBindings']]:
        bound(entry)
    manifest = json.loads(Path(plan['actualCompiledBasis']['productManifest']['path']).read_text())
    require(manifest['count'] == 53 and manifest['symlinks'] == [] and manifest['root'] == plan['actualCompiledBasis']['productRoot'], 'Invalid compiled manifest')
    entries = manifest['regularFiles']; source = Path(manifest['root']); verify_products(source, entries)
    value = plistlib.loads(Path(plan['actualCompiledBasis']['originalXctestrun']['path']).read_bytes())
    require(set(value) == {'CrossParagraphControl', '__xctestrun_metadata__'} and value['__xctestrun_metadata__']['FormatVersion'] == 1, 'Wrong actual xctestrun structure')
    target = value['CrossParagraphControl']
    require(target['TestHostBundleIdentifier'] == 'app.slax.reader.crossparagraphfixture.control.xctrunner' and
            target['TestHostPath'] == '__TESTROOT__/Debug-iphonesimulator/CrossParagraphControl-Runner.app' and
            target['UITargetAppPath'] == '__TESTROOT__/Debug-iphonesimulator/CrossParagraphHost.app', 'Wrong helper identity/root resolution')
    regular(DEVICE_ROOT / 'device.plist')
    device = plistlib.loads((DEVICE_ROOT / 'device.plist').read_bytes())
    require(device['UDID'] == DEVICE and device['name'] == plan['device']['name'] and device['deviceType'] == plan['device']['deviceType'] and
            device['runtime'] == plan['device']['runtime'] and device['state'] == 1, 'Owned device is not exact Shutdown device')
    other_plist = DEVICE_ROOT.parent / OWNED_DEVICES[1] / 'device.plist'
    regular(other_plist); other = plistlib.loads(other_plist.read_bytes())
    require(other['UDID'] == OWNED_DEVICES[1] and other['state'] == 1, 'Owned88 migration loan is not Shutdown')
    bound(plan['ownedMigrationLoans'][1]['publicRelease'])
    require([e['UDID'] for e in plan['ownedMigrationLoans']] == OWNED_DEVICES, 'Wrong closed owned migration loan list')
    bound(plan['supersedesPreparedPlan']); bound(plan['preservedActualAdmissionFailure'])
    require(not RUN_ROOT.exists() and not RUN_ROOT.is_symlink(), 'Never reuse the one-attempt run root')
    stage = verify_stage()
    return plan, policy, entries, source, stage


def allocation(path, expected_sha, policy):
    require(path == Path(policy['allocationPath']) and len(expected_sha) == 64, 'Only the exact fresh Root allocation is allowed')
    require(sha(bound({'path': str(path), 'bytes': regular(path).st_size, 'sha256': expected_sha})) == expected_sha, 'Allocation changed')
    grant = json.loads(path.read_text())
    expected = {'kind': 'root-one-cross-bitmap-only-native-allocation', 'version': 1, 'executorSHA256': sha(Path(__file__)),
                'runtimePolicySHA256': sha(POLICY), 'basePlanSHA256': BASE_SHA, 'runRoot': str(RUN_ROOT), 'device': DEVICE,
                'onlyTestIdentifier': SELECTOR, 'attempts': 1, 'noTargetInput': True, 'exclusiveDeviceLoan': True,
                'ownedMigrationDevices': OWNED_DEVICES, 'allOwnedMigrationLoansReleased': True}
    require(all(grant.get(k) == v for k, v in expected.items()), 'Allocation scope/hash mismatch')
    require(type(grant.get('expiresAtUnixSeconds')) in (int, float) and time.time() < grant['expiresAtUnixSeconds'], 'Expired/missing allocation')
    return grant


def container_candidates(device_root):
    result = {}
    for kind in ('Bundle', 'Data'):
        base = device_root / 'data/Containers' / kind / 'Application'
        if not base.exists():
            continue
        require(not base.is_symlink(), 'Symlink container registry refused')
        for path in base.iterdir():
            require(path.is_dir() and not path.is_symlink(), 'Unknown container registry entry')
            metadata = path / '.com.apple.mobile_container_manager.metadata.plist'
            identifier = None
            if metadata.exists():
                value = regular(metadata); require(value.st_size <= 65536, 'Oversize container identity metadata')
                identifier = plistlib.loads(metadata.read_bytes()).get('MCMMetadataIdentifier')
            result[str(path)] = identifier
    return result


def installed_accounting(device_root, baseline, active=False):
    candidates = container_candidates(device_root)
    require(all(identifier not in IDENTITIES for identifier in baseline.values()), 'Helper identities already existed before this one attempt')
    paths = []; pending = []
    for path, identifier in candidates.items():
        if path in baseline:
            require(identifier == baseline[path], 'Pre-existing container identity changed')
            continue
        require(identifier in IDENTITIES or (active and identifier is None), 'Unexpected new non-helper container refused')
        if identifier is None:
            pending.append(path)
        paths.append({'path': path, 'identifier': identifier, **tree(Path(path), active)})
    return {'containers': paths, 'pendingIdentities': pending,
            'logicalBytes': sum(e['logicalBytes'] for e in paths), 'allocatedBytes': sum(e['allocatedBytes'] for e in paths)}


def free_bytes():
    value = os.statvfs('/private/tmp'); return value.f_bavail * value.f_frsize


def resource_guard(own, installed, free, log_bytes, before=False):
    require(free >= (PRE_FREE if before else FLOOR), 'Free-space floor/reserve crossed')
    require(own['logicalBytes'] + installed['logicalBytes'] + RECEIPT_RESERVE <= CAP and
            own['allocatedBytes'] + installed['allocatedBytes'] + RECEIPT_RESERVE <= CAP, 'Distinct copied/installed/runtime artifacts exceed128MiB')
    require(log_bytes <= LOG_CAP, 'Combined command output exceeds8MiB')


def test_command():
    return [XCODE, 'test-without-building', '-xctestrun', str(RUN_ROOT / 'Products/CrossParagraphControl_iphonesimulator26.5-arm64.xctestrun'),
            '-destination', 'platform=iOS Simulator,id=' + DEVICE, '-parallel-testing-enabled', 'NO',
            '-maximum-concurrent-test-simulator-destinations', '1', '-jobs', '1', '-only-testing:' + SELECTOR,
            '-resultBundlePath', str(RUN_ROOT / 'bitmap-only.xcresult')]


def exact_command(argv):
    sim = [XCRUN, 'simctl']
    allowed = [sim + ['list', 'devices', '--json'], sim + ['boot', DEVICE], sim + ['bootstatus', DEVICE, '-b'],
               sim + ['status_bar', DEVICE, 'override', '--time', '09:41'], sim + ['ui', DEVICE, 'appearance', 'light'],
               sim + ['ui', DEVICE, 'content_size', 'large'], sim + ['status_bar', DEVICE, 'clear'],
               sim + ['shutdown', DEVICE], *[sim + ['terminate', DEVICE, identity] for identity in sorted(IDENTITIES)],
               test_command(), [XCRUN, 'xcresulttool', 'get', 'test-results', 'tests', '--path', str(RUN_ROOT / 'bitmap-only.xcresult')]]
    require(argv in allowed, 'Unallocated command/selector refused')


class Executor:
    def __init__(self, policy, entries, source, stage):
        self.policy, self.entries, self.source, self.stage = policy, entries, source, stage
        self.started = time.monotonic(); self.commands = []; self.samples = []; self.boot_issued = False
        self.baseline = container_candidates(DEVICE_ROOT); self.log_bytes = 0
        installed_accounting(DEVICE_ROOT, self.baseline)
        resource_guard({'logicalBytes': 0, 'allocatedBytes': 0}, {'logicalBytes': 0, 'allocatedBytes': 0}, free_bytes(), 0, True)
        RUN_ROOT.mkdir(mode=0o700); (RUN_ROOT / 'logs').mkdir(); (RUN_ROOT / 'tmp').mkdir()
        self.receipt = {'kind': 'cross-paragraph-bitmap-only-native-attempt', 'version': 1, 'basePlanSHA256': BASE_SHA,
                        'policySHA256': sha(POLICY), 'executorSHA256': sha(Path(__file__)), 'device': DEVICE,
                        'onlyTestIdentifier': SELECTOR, 'commands': self.commands, 'resourceSamples': self.samples,
                        'nativeBitmapAccepted': False, 'verdictRequiresIndependentRawXCResultReview': True, 'noTargetInput': True}
        self.save()

    def remaining(self):
        return TOTAL - (time.monotonic() - self.started)

    def save(self):
        temporary = RUN_ROOT / 'receipt.json.tmp'
        temporary.write_text(json.dumps(self.receipt, indent=2) + '\n'); temporary.replace(RUN_ROOT / 'receipt.json')

    def resources(self, active=True):
        own = tree(RUN_ROOT, active); installed = installed_accounting(DEVICE_ROOT, self.baseline, active)
        self.log_bytes = sum(p.stat().st_size for p in (RUN_ROOT / 'logs').iterdir() if p.is_file())
        sample = {'elapsedSeconds': time.monotonic() - self.started, 'freeBytes': free_bytes(),
                  'owned': own, 'installed': installed, 'logBytes': self.log_bytes}
        require(len(self.samples) < 512, 'Bounded resource sampler exhausted')
        self.samples.append(sample); resource_guard(own, installed, sample['freeBytes'], self.log_bytes)
        return sample

    def stop(self, process):
        if process.poll() is not None:
            return
        require(os.getpgid(process.pid) == process.pid, 'Refuse to signal another process group')
        os.killpg(process.pid, signal.SIGTERM)
        try:
            process.wait(timeout=min(GRACE, max(0.1, self.remaining())))
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL); process.wait(timeout=2)

    def command(self, argv, seconds, release=False):
        exact_command(argv)
        budget = min(seconds, self.remaining() - GRACE - (0 if release else RELEASE_RESERVE))
        require(budget > 0, 'No bounded command time remains')
        index = len(self.commands); out_path = RUN_ROOT / f'logs/{index:02d}.stdout'; err_path = RUN_ROOT / f'logs/{index:02d}.stderr'
        record = {'argv': argv, 'timeoutSeconds': budget, 'stdout': str(out_path), 'stderr': str(err_path), 'exitCode': None, 'stopped': None}
        self.commands.append(record); self.save(); started = time.monotonic(); process = None
        env = {'PATH': '/usr/bin:/bin:/usr/sbin:/sbin', 'DEVELOPER_DIR': '/Applications/Xcode.app/Contents/Developer', 'TMPDIR': str(RUN_ROOT / 'tmp')}
        for key in ('HOME', 'USER', 'LOGNAME'):
            if key in os.environ:
                env[key] = os.environ[key]
        try:
            if not release:
                self.resources()
            with out_path.open('wb') as out, err_path.open('wb') as err:
                process = subprocess.Popen(argv, stdout=out, stderr=err, env=env, cwd=RUN_ROOT, start_new_session=True)
                record['ownedPID'] = process.pid
                while process.poll() is None:
                    if time.monotonic() - started >= budget:
                        raise ValueError('Owned command deadline exceeded')
                    if release:
                        require(sum(p.stat().st_size for p in (RUN_ROOT / 'logs').iterdir() if p.is_file()) <= LOG_CAP, 'Release output limit crossed')
                    else:
                        self.resources()
                    time.sleep(0.5)
                record['exitCode'] = process.returncode
            if not release:
                self.resources()
        except Exception as error:
            record['stopped'] = type(error).__name__ + ': ' + str(error)
            if process is not None and process.poll() is None:
                self.stop(process); record['exitCode'] = process.returncode
            raise
        finally:
            record['elapsedSeconds'] = time.monotonic() - started
            for key, path in (('stdoutSHA256', out_path), ('stderrSHA256', err_path)):
                if path.exists(): record[key] = sha(path)
            self.save()
        require(record['exitCode'] == 0 or release, 'Allocated command exited nonzero')
        return out_path

    def check_device_list(self, path, shutdown):
        data = json.loads(path.read_text()); devices = [d for values in data['devices'].values() for d in values]
        selected = [d for d in devices if d['udid'] == DEVICE]
        require(len(selected) == 1 and selected[0]['state'] == ('Shutdown' if shutdown else 'Booted'), 'Owned device state readback failed')
        owned_other = [d for d in devices if d['udid'] == OWNED_DEVICES[1]]
        require(len(owned_other) == 1 and owned_other[0]['state'] == 'Shutdown', 'Owned88 migration loan is live or absent')
        self.receipt['unrelatedSimulatorStateMetadata'] = [{k: d[k] for k in ('udid', 'name', 'state', 'isAvailable') if k in d} for d in devices if d['udid'] not in OWNED_DEVICES]

    def copy_products(self):
        destination = RUN_ROOT / 'Products'; destination.mkdir()
        for entry in self.entries:
            require(self.remaining() > RELEASE_RESERVE, 'Copy deadline exhausted'); self.resources()
            relative = safe_relative(entry['relativePath']); src = self.source / relative; dst = destination / relative
            dst.parent.mkdir(parents=True, exist_ok=True)
            with src.open('rb') as source, dst.open('xb') as target:
                for chunk in iter(lambda: source.read(1048576), b''):
                    target.write(chunk)
            dst.chmod(entry['mode'])
        verify_products(destination, self.entries); verify_products(self.source, self.entries)

    def run(self):
        error = None
        try:
            self.check_device_list(self.command([XCRUN, 'simctl', 'list', 'devices', '--json'], 8), True)
            self.copy_products(); self.boot_issued = True
            self.command([XCRUN, 'simctl', 'boot', DEVICE], 15)
            self.command([XCRUN, 'simctl', 'bootstatus', DEVICE, '-b'], 45)
            self.command([XCRUN, 'simctl', 'status_bar', DEVICE, 'override', '--time', '09:41'], 5)
            self.command([XCRUN, 'simctl', 'ui', DEVICE, 'appearance', 'light'], 5)
            self.command([XCRUN, 'simctl', 'ui', DEVICE, 'content_size', 'large'], 5)
            require(self.remaining() >= TEST_TIMEOUT + GRACE + RELEASE_RESERVE, 'Insufficient test+release reserve; no retry')
            self.command(test_command(), TEST_TIMEOUT)
            raw = self.command([XCRUN, 'xcresulttool', 'get', 'test-results', 'tests', '--path', str(RUN_ROOT / 'bitmap-only.xcresult')], 5)
            self.receipt['rawTestResults'] = {'path': str(raw), 'sha256': sha(raw)}
            self.receipt['copiedProductsAfterTest'] = product_records(RUN_ROOT / 'Products')
            self.receipt['rawXCResultFiles'] = product_records(RUN_ROOT / 'bitmap-only.xcresult')
            final_resources = self.resources(False)
            self.receipt['installedHelperManifests'] = [dict(path=e['path'], identifier=e['identifier'], regularFiles=product_records(Path(e['path']))) for e in final_resources['installed']['containers']]
        except Exception as failure:
            error = type(failure).__name__ + ': ' + str(failure); self.receipt['refusal'] = error
        finally:
            if self.boot_issued:
                for argv, seconds in [*[( [XCRUN, 'simctl', 'terminate', DEVICE, identity], 4) for identity in sorted(IDENTITIES)],
                                      ([XCRUN, 'simctl', 'status_bar', DEVICE, 'clear'], 4),
                                      ([XCRUN, 'simctl', 'shutdown', DEVICE], 8)]:
                    try: self.command(argv, seconds, True)
                    except Exception as failure: self.receipt.setdefault('releaseFailures', []).append(str(failure))
                try:
                    self.check_device_list(self.command([XCRUN, 'simctl', 'list', 'devices', '--json'], 4, True), True)
                    self.receipt['ownedDeviceShutdownReadback'] = True
                except Exception as failure: self.receipt.setdefault('releaseFailures', []).append(str(failure))
            try:
                verify_products(self.source, self.entries); verify_stage()
                self.receipt['protectedOriginalProductsAndStageUnchanged'] = True
                self.resources(False)
            except Exception as failure: self.receipt['protectedBindingFailure'] = str(failure); error = error or str(failure)
            self.receipt['elapsedSeconds'] = time.monotonic() - self.started
            if self.receipt['elapsedSeconds'] > TOTAL:
                error = error or 'Total120-second deadline exceeded'
                self.receipt['refusal'] = error
            self.receipt['status'] = 'raw-native-result-awaiting-independent-review' if not error and not self.receipt.get('releaseFailures') else 'stopped-or-release-unconfirmed'
            self.save()
        return 0 if self.receipt['status'] == 'raw-native-result-awaiting-independent-review' else 1


def main():
    parser = argparse.ArgumentParser(); parser.add_argument('--execute', action='store_true')
    parser.add_argument('--allocation', type=Path); parser.add_argument('--allocation-sha256')
    args = parser.parse_args()
    plan, policy, entries, source, stage = admission()
    if not args.execute:
        require(args.allocation is None and args.allocation_sha256 is None, 'Read-only mode takes no execution grant')
        print(json.dumps({'status': 'readonly-preflight-pass', 'basePlanSHA256': BASE_SHA, 'policySHA256': sha(POLICY),
                          'compiledProducts': len(entries), 'stage': stage, 'nativeExecuted': False, 'runRootCreated': False}))
        return 0
    require(args.allocation is not None and args.allocation_sha256 is not None, 'Fresh Root allocation required')
    grant = allocation(args.allocation, args.allocation_sha256, policy)
    executor = Executor(policy, entries, source, stage); executor.receipt['allocation'] = {'path': str(args.allocation), 'sha256': args.allocation_sha256, 'grant': grant}
    return executor.run()


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (ValueError, OSError, KeyError, plistlib.InvalidFileException, json.JSONDecodeError) as error:
        print(json.dumps({'status': 'refused-before-or-outside-native-command', 'error': str(error)})); raise SystemExit(1)
