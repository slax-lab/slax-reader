#!/usr/bin/env python3
"""Prepared build-for-testing executor. It never runs a native test or a device command."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import plistlib
import re
import shutil
import signal
import stat
import struct
import subprocess
import time

PROJECT_ROOT = Path(__file__).resolve().parent
PLAN_PATH = PROJECT_ROOT / 'build-plan.json'
FLOOR = 3 * 1024 ** 3
RESERVE_FLOOR = 3865470566
PRODUCT_CAP = 250 * 1024 ** 2
LOG_CAP = 8 * 1024 ** 2
DEADLINE = 180
STOP_GRACE = 4
RECEIPT_RESERVE = 1024 ** 2
XCODEBUILD = '/Applications/Xcode.app/Contents/Developer/usr/bin/xcodebuild'
SPARSE_COMPILATION_METADATA = {
    'CompilationCache.noindex/generic/v1.1/v3.actions': 1073741824,
    'CompilationCache.noindex/generic/v1.1/v8.index': 8589934592,
    'CompilationCache.noindex/generic/v1.1/v8.data': 17179869184,
}
INPUT_NAMES = {
    'ControlHost.swift', 'ReaderCrossParagraphControl.swift', 'reference-alpha.png',
    'CrossParagraphControl.xcodeproj/project.pbxproj',
    'CrossParagraphControl.xcodeproj/xcshareddata/xcschemes/CrossParagraphControl.xcscheme',
    'build.py', 'build-guards.test.py', 'README.md',
}
PROTECTED_NAMES = {
    '../ReaderCrossParagraphControl.swift', '../../ControlHost.swift',
    '../../ReaderNativeControl.swift', '../../ReaderNativeControl.xcodeproj/project.pbxproj',
    '../../ReaderNativeControl.xcodeproj/xcshareddata/xcschemes/ReaderNativeControl.xcscheme',
}


def require(condition, reason):
    if not condition:
        raise ValueError(reason)


def digest(path):
    result = hashlib.sha256()
    with path.open('rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            result.update(chunk)
    return result.hexdigest()


def regular(path):
    require(path.is_absolute(), 'Require an absolute public input')
    require(all(not p.is_symlink() for p in [path, *path.parents]), 'Reject a symlinked public input')
    value = path.lstat()
    require(stat.S_ISREG(value.st_mode), 'Require a regular public input')
    return value


def checked_plan(plan):
    require(plan.get('kind') == 'cross-paragraph-native-build-plan' and plan.get('version') == 1,
            'Wrong prepared plan')
    require(plan.get('projectRoot') == str(PROJECT_ROOT), 'Wrong closed project root')
    require(plan.get('copyClosedInputsToOwnedDD') is True, 'Compile only the closed owned-DD project copy')
    require(plan.get('floorBytes') == FLOOR and plan.get('preBuildFreeBytes') == RESERVE_FLOOR and
            plan.get('productCapBytes') == PRODUCT_CAP and plan.get('logCapBytes') == LOG_CAP and
            plan.get('deadlineSeconds') == DEADLINE and plan.get('jobs') == 1,
            'Prepared limits cannot be relaxed by a runtime argument')
    dd = Path(plan.get('derivedDataRoot', ''))
    require(dd.is_absolute() and dd.parent == Path('/private/tmp') and
            re.fullmatch(r'slax-reader-cross-paragraph-build-[0-9a-f]{32}', dd.name) is not None,
            'Require one unique direct-child owned DerivedData path')
    require(not dd.exists() and not dd.is_symlink(), 'Never reuse or overwrite existing DerivedData')
    inputs = plan.get('inputs', [])
    require(len(inputs) == len(INPUT_NAMES) and {e.get('relativePath') for e in inputs} == INPUT_NAMES,
            'The project input list must be the exact closed set')
    for entry in inputs:
        relative = entry['relativePath']
        require(re.fullmatch(r'[0-9a-f]{64}', entry.get('sha256', '')) is not None and
                type(entry.get('bytes')) is int and entry['bytes'] >= 0, 'Invalid input binding')
        path = PROJECT_ROOT / relative
        value = regular(path)
        require(value.st_size == entry['bytes'] and digest(path) == entry['sha256'],
                'Changed prepared project input: ' + relative)
    protected = plan.get('protectedLegacyInputs', [])
    require(len(protected) == len(PROTECTED_NAMES) and
            {e.get('relativePath') for e in protected} == PROTECTED_NAMES,
            'Require the unchanged original driver/legacy helper closed set')
    for entry in protected:
        path = (PROJECT_ROOT / entry['relativePath']).absolute()
        value = regular(path)
        require(value.st_size == entry['bytes'] and digest(path) == entry['sha256'],
                'Original driver/legacy helper changed')
    return dd


def tree_accounting(root, active_build=False):
    logical = apparent = count = 0
    sparse_stat_caches, sparse_compilation_metadata, vanished_generated_entries = [], [], []
    allocated = root.lstat().st_blocks * 512
    def vanished_generated(path):
        relative = path.relative_to(root)
        return bool(relative.parts) and relative.parts[0] in (
            'Build', 'ModuleCache.noindex', 'SDKStatCaches.noindex', 'Index.noindex', 'Logs')
    def walk_error(error):
        if active_build and isinstance(error, FileNotFoundError) and error.filename and vanished_generated(Path(error.filename)):
            vanished_generated_entries.append(str(error.filename)); return
        raise error
    for directory, directories, files in os.walk(root, followlinks=False, onerror=walk_error):
        for name in [*directories, *files]:
            path = Path(directory) / name
            try:
                value = path.lstat()
            except FileNotFoundError:
                if not active_build or not vanished_generated(path):
                    raise
                vanished_generated_entries.append(str(path)); continue
            count += 1
            allocated += value.st_blocks * 512
            if stat.S_ISREG(value.st_mode):
                apparent += value.st_size
                relative = path.relative_to(root)
                # Only the exact regular sparse SDK cache under this owned DD
                # can exclude apparent size. Actual blocks always count above.
                sparse_sdk = (len(relative.parts) == 2 and
                    relative.parts[0] == 'SDKStatCaches.noindex' and
                    relative.name.endswith('.sdkstatcache') and
                    value.st_blocks * 512 < value.st_size)
                sparse_metadata = (SPARSE_COMPILATION_METADATA.get(relative.as_posix()) == value.st_size and
                    value.st_blocks * 512 < value.st_size)
                if sparse_sdk:
                    sparse_stat_caches.append({'path': str(path), 'apparentBytes': value.st_size,
                                              'allocatedBytes': value.st_blocks * 512})
                elif sparse_metadata:
                    # These three exact sparse metadata files were observed in
                    # Source44 and aw4 even with all compile-cache settings NO.
                    sparse_compilation_metadata.append({'path': str(path), 'apparentBytes': value.st_size,
                                                        'allocatedBytes': value.st_blocks * 512})
                else:
                    logical += value.st_size
            elif stat.S_ISLNK(value.st_mode):
                # Do not follow links, including SDK/framework references.
                logical += value.st_size
                apparent += value.st_size
            elif not stat.S_ISDIR(value.st_mode):
                raise ValueError('Unexpected owned product file type')
    return {'logicalBytes': logical, 'apparentLogicalBytes': apparent, 'allocatedBytes': allocated,
            'entries': count, 'regularSparseSDKStatCaches': sorted(sparse_stat_caches, key=lambda e: e['path']),
            'regularSparseCompilationMetadata': sorted(sparse_compilation_metadata, key=lambda e: e['path']),
            'vanishedGeneratedEntriesDuringActiveBuild': sorted(vanished_generated_entries)}


def free_bytes(path):
    value = os.statvfs(path)
    return value.f_bavail * value.f_frsize


def resource_guard(accounting, free, log_size, before=False):
    require(free >= (RESERVE_FLOOR if before else FLOOR), 'Free-space floor/reserve was crossed')
    require(accounting['logicalBytes'] + RECEIPT_RESERVE <= PRODUCT_CAP and
            accounting['allocatedBytes'] + RECEIPT_RESERVE <= PRODUCT_CAP,
            'All distinct owned products/logs exceed250MiB')
    require(log_size <= LOG_CAP, 'Owned native build log exceeds8MiB')


def command(dd):
    return [XCODEBUILD, '-project', str(dd / 'Project/CrossParagraphControl.xcodeproj'),
            '-scheme', 'CrossParagraphControl', '-configuration', 'Debug', '-sdk', 'iphonesimulator',
            '-destination', 'generic/platform=iOS Simulator', '-derivedDataPath', str(dd), '-jobs', '1',
            'ARCHS=arm64', 'ONLY_ACTIVE_ARCH=YES', 'CODE_SIGNING_ALLOWED=NO',
            'INDEX_ENABLE_DATA_STORE=NO', 'COMPILATION_CACHE_ENABLE_CACHING=NO',
            'CLANG_ENABLE_COMPILE_CACHE=NO', 'SWIFT_ENABLE_COMPILE_CACHE=NO',
            'CLANG_MODULE_CACHE_PATH=' + str(dd / 'ModuleCache.noindex'),
            'MODULE_CACHE_DIR=' + str(dd / 'ModuleCache.noindex'),
            'SDK_STAT_CACHE_DIR=' + str(dd), 'build-for-testing']


def stop_own_process_group(process):
    if process.poll() is not None:
        return
    try:
        require(os.getpgid(process.pid) == process.pid, 'Refuse a process group not created by this executor')
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        if process.poll() is not None:
            return
        raise
    try:
        process.wait(timeout=2)
    except subprocess.TimeoutExpired:
        if process.poll() is None:
            try:
                require(os.getpgid(process.pid) == process.pid, 'Refuse an unrelated process group')
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                if process.poll() is None:
                    raise
        process.wait(timeout=2)


def products(root):
    entries = []
    for directory, _, files in os.walk(root, followlinks=False):
        for name in files:
            path = Path(directory) / name
            value = path.lstat()
            if stat.S_ISREG(value.st_mode):
                entries.append({'path': str(path), 'bytes': value.st_size,
                                'mode': stat.S_IMODE(value.st_mode), 'sha256': digest(path)})
    return sorted(entries, key=lambda e: e['path'])


def arm64_macho(path):
    with path.open('rb') as value:
        header = value.read(12)
    require(len(header) == 12, 'Missing actual compiled Mach-O header')
    magic, cpu, subtype = struct.unpack('<Iii', header)
    require(magic == 0xfeedfacf and cpu == 0x0100000c, 'Require the actual thin arm64 Mach-O')
    return {'magic': hex(magic), 'cpuType': cpu, 'cpuSubtype': subtype, 'architecture': 'arm64'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--execute', action='store_true')
    parser.add_argument('--reviewed-plan-sha256')
    args = parser.parse_args()
    regular(PLAN_PATH)
    raw_plan = PLAN_PATH.read_bytes()
    plan = json.loads(raw_plan)
    dd = checked_plan(plan)
    plan_sha = hashlib.sha256(raw_plan).hexdigest()
    if not args.execute:
        print(json.dumps({'status': 'prepared-only-no-native-invocation', 'planSha256': plan_sha,
                          'derivedDataRoot': str(dd), 'command': command(dd),
                          'nativeTestsExecuted': False, 'nativeCrossParagraphAccepted': False}))
        return
    require(args.reviewed_plan_sha256 == plan_sha, 'Require the exact independently reviewed plan hash')
    regular(Path(XCODEBUILD))
    pre_free = free_bytes(dd.parent)
    resource_guard({'logicalBytes': 0, 'allocatedBytes': 0}, pre_free, 0, before=True)
    # Fresh exclusive ownership, no cleanup/restart/second native command.
    dd.mkdir(mode=0o700)
    owner = {'kind': 'cross-paragraph-native-build-owner', 'version': 1,
             'derivedDataRoot': str(dd), 'projectRoot': str(PROJECT_ROOT),
             'planSha256': plan_sha, 'executorSha256': digest(Path(__file__)),
             'nativeTestsExecuted': False}
    (dd / '.slax-cross-paragraph-owner.json').write_text(json.dumps(owner, indent=2) + '\n')
    compiled_project = dd / 'Project'
    compiled_project.mkdir(mode=0o700)
    for entry in plan['inputs']:
        source = PROJECT_ROOT / entry['relativePath']
        destination = compiled_project / entry['relativePath']
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, destination)
        require(regular(destination).st_size == entry['bytes'] and digest(destination) == entry['sha256'],
                'Owned-DD project copy differs from the reviewed input')
    log = dd / 'build.log'
    before = time.monotonic()
    process = None
    refusal = None
    exit_code = None
    try:
        resource_guard(tree_accounting(dd), free_bytes(dd), 0, before=True)
        with log.open('xb') as output:
            process = subprocess.Popen(command(dd), stdout=output, stderr=subprocess.STDOUT,
                                       cwd=compiled_project, start_new_session=True)
            while True:
                require(time.monotonic() - before <= DEADLINE - STOP_GRACE,
                        'Native build reached the180-second termination reserve')
                resource_guard(tree_accounting(dd, active_build=True), free_bytes(dd), log.stat().st_size)
                exit_code = process.poll()
                if exit_code is not None:
                    break
                time.sleep(0.5)
    except Exception as error:
        refusal = str(error)
        if process is not None:
            stop_own_process_group(process)
            exit_code = process.returncode
    # Preserve incomplete bytes and failures. Never remove cache/products here.
    accounting = tree_accounting(dd)
    tail = b''
    if log.is_file():
        with log.open('rb') as value:
            value.seek(max(0, log.stat().st_size - 65536))
            tail = value.read()
    completed = exit_code == 0 and refusal is None and b'** TEST BUILD SUCCEEDED **' in tail
    result = {'kind': 'cross-paragraph-native-build-receipt', 'version': 1,
              'planSha256': plan_sha, 'executorSha256': owner['executorSha256'], 'command': command(dd),
              'exitCode': exit_code, 'refused': refusal, 'completedBuildForTesting': completed,
              'elapsedSeconds': time.monotonic() - before, 'preFreeBytes': pre_free,
              'postFreeBytesBeforeReceipt': free_bytes(dd), 'accountingBeforeReceipt': accounting,
              'receiptReserveBytes': RECEIPT_RESERVE,
              'log': {'path': str(log), 'sha256': digest(log) if log.exists() else None,
                      'bytes': log.stat().st_size if log.exists() else 0},
              'inputsStillMatch': False, 'nativeTestsExecuted': False,
              'compiledProjectRoot': str(compiled_project), 'compiledCopiesStillMatch': False,
              'nativeBitmapOrientationVerified': False, 'nativeCrossParagraphAccepted': False,
              'deviceOrSimulatorCommands': False, 'productManifest': []}
    try:
        # Revalidate exact closed inputs without the fresh-DD admission branch.
        require(digest(PLAN_PATH) == plan_sha, 'Reviewed plan changed during native build')
        for entry in [*plan['inputs'], *plan['protectedLegacyInputs']]:
            path = (PROJECT_ROOT / entry['relativePath']).absolute()
            require(regular(path).st_size == entry['bytes'] and digest(path) == entry['sha256'],
                    'Prepared source changed during native build')
        result['inputsStillMatch'] = True
        for entry in plan['inputs']:
            path = compiled_project / entry['relativePath']
            require(regular(path).st_size == entry['bytes'] and digest(path) == entry['sha256'],
                    'Closed compiled project copy changed during native build')
        result['compiledCopiesStillMatch'] = True
        if completed:
            product_root = dd / 'Build/Products'
            result['productManifest'] = products(product_root)
            xctestruns = list(product_root.glob('*.xctestrun'))
            require(len(xctestruns) == 1, 'Require exactly one actual xctestrun')
            value = plistlib.loads(xctestruns[0].read_bytes())
            require(isinstance(value, dict), 'Actual xctestrun is not a plist dictionary')
            result['xctestrun'] = {'path': str(xctestruns[0]), 'sha256': digest(xctestruns[0])}
            required = ('CrossParagraphHost.app/CrossParagraphHost',
                        'CrossParagraphControl.xctest/CrossParagraphControl')
            for suffix in required:
                matched = [e for e in result['productManifest'] if e['path'].endswith(suffix)]
                require(len(matched) == 1, 'Require the unique actual compiled host/test Mach-O: ' + suffix)
                matched[0]['actualMachOHeader'] = arm64_macho(Path(matched[0]['path']))
            resource_guard(tree_accounting(dd), free_bytes(dd), log.stat().st_size)
    except Exception as error:
        result['completedBuildForTesting'] = False
        result['refused'] = str(error)
    receipt = dd / 'build-receipt.json'
    raw = (json.dumps(result, indent=2) + '\n').encode()
    require(len(raw) <= RECEIPT_RESERVE and free_bytes(dd) - len(raw) >= FLOOR,
            'Receipt must fit the reserved owned budget/free-space floor')
    with receipt.open('xb') as output:
        output.write(raw)
    print(json.dumps({'receiptPath': str(receipt), 'sha256': digest(receipt),
                      'completedBuildForTesting': result['completedBuildForTesting'],
                      'actualFinalAccounting': tree_accounting(dd), 'actualFinalFreeBytes': free_bytes(dd),
                      'nativeTestsExecuted': False, 'refused': result['refused']}))
    if not result['completedBuildForTesting']:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
