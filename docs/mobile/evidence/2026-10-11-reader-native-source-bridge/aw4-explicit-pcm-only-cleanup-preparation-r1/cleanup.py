#!/usr/bin/env python3
"""Closed PCM-only cleanup; check mode is read-only, execution needs a new allocation."""
import argparse
import hashlib
import json
import os
import re
import stat
import subprocess
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
DD = Path('/private/tmp/slax-reader-nativebridge-ios-aw4-deriveddata')
RELATIVE = 'Build/Intermediates.noindex/ExplicitPrecompiledModules'
CANDIDATE = DD / RELATIVE
DEADLINE = None


def tick():
    if DEADLINE is not None and time.monotonic() > DEADLINE:
        raise RuntimeError('120-second cleanup deadline')


def digest(path):
    tick()
    h = hashlib.sha256()
    with Path(path).open('rb') as source:
        for block in iter(lambda: source.read(1024 * 1024), b''):
            tick()
            h.update(block)
    return h.hexdigest()


def read_bound(record):
    path = Path(record['path'])
    assert not path.is_symlink() and path.is_file(), path
    assert digest(path) == record['sha256'], path
    return json.loads(path.read_text())


def validate_row(row, after=False):
    relative = Path(row['path'])
    assert not relative.is_absolute() and '..' not in relative.parts, relative
    path = DD / relative
    info = path.lstat()
    assert not stat.S_ISLNK(info.st_mode), path
    assert info.st_dev == row['device'] and info.st_ino == row['inode'], path
    assert stat.S_IMODE(info.st_mode) == row['mode'], path
    if row['kind'] == 'file':
        assert stat.S_ISREG(info.st_mode) and info.st_size == row['logicalBytes'], path
        assert info.st_mtime_ns == row['mtimeNs'] and digest(path) == row['sha256'], path
    else:
        assert row['kind'] == 'directory' and stat.S_ISDIR(info.st_mode), path
        if not (after and str(relative) == 'Build/Intermediates.noindex'):
            assert info.st_mtime_ns == row['mtimeNs'], path


def verify_external(rows):
    for row in rows:
        path = Path(row['path'])
        assert not path.is_symlink() and path.is_file(), path
        assert path.stat().st_size == row['bytes'] and digest(path) == row['sha256'], path


def verify_idle():
    result = subprocess.run(['/bin/ps', '-axo', 'command='], check=True, capture_output=True, text=True, timeout=5)
    for line in result.stdout.splitlines():
        if str(DD) in line or str(DD).replace('/private/tmp/', '/tmp/') in line:
            assert not re.search(r'\b(xcodebuild|clang(?:\+\+)?|swift-frontend|swiftc)\b', line), 'An active command still owns this DerivedData'


def check(plan):
    assert plan['kind'] == 'slax-aw4-explicit-pcm-only-cleanup-preparation'
    assert plan['derivedData'] == str(DD) and plan['onlyCandidate'] == str(CANDIDATE)
    assert DD.resolve() == DD and not DD.is_symlink() and CANDIDATE.resolve() == CANDIDATE
    assert plan['allocatedCandidateBytes'] == 789962752 and plan['removed'] is False
    inputs = {Path(row['path']).name: row for row in plan['inputs']}
    loaded = {name: read_bound(row) for name, row in inputs.items()}
    assert digest(plan['ownedOwner']['path']) == plan['ownedOwner']['sha256']
    assert digest(plan['currentStageMarker']['path']) == plan['currentStageMarker']['sha256']
    pcm = loaded['pcm-inventory.json']
    protected = loaded['protected-dd-and-pods-inventory.json']
    assert len(pcm) == 4065 and sum(row['kind'] == 'directory' for row in pcm) == 1
    assert {row['path'] for row in pcm} == {RELATIVE} | {RELATIVE + '/' + path.name for path in CANDIDATE.iterdir()}
    for row in pcm:
        assert row['path'] == RELATIVE or Path(row['path']).parent == Path(RELATIVE)
        validate_row(row)
    for row in protected:
        assert not row['path'].startswith(RELATIVE)
        validate_row(row)
    verify_external(loaded['new-source-cross-protected-products.json'])
    protection = loaded['current-stage-native-log-protection.json']
    # This archived r4 protection document contains public source/compiled/log bindings.
    stage = Path(plan['currentStageMarker']['path']).parent
    for row in protection['generatedInputs']:
        relative = Path(row['path'])
        assert not relative.is_absolute() and '..' not in relative.parts
        assert digest(stage / relative) == row['sha256'], row['path']
    for key in ['publicPodAndNativeInputs', 'protectedLogFiles']:
        for row in protection[key]:
            assert Path(row['path']).is_absolute()
            assert digest(row['path']) == row['sha256'], row['path']
    for row in protection['installedAppAndData'].values():
        if isinstance(row, dict) and 'path' in row and 'sha256' in row:
            assert digest(row['path']) == row['sha256'], row['path']
    verify_idle()
    return pcm, protected, loaded['new-source-cross-protected-products.json']


def allocate(path, expected, plan_path):
    path = Path(path)
    assert path.resolve() == path and path.name == 'allocation.json' and not path.is_symlink()
    assert path.parent.parent == Path('/private/tmp') and path.parent.name.startswith('slax-aw4-pcm-cleanup-')
    assert digest(path) == expected
    value = json.loads(path.read_text())
    assert value['kind'] == 'slax-root-one-aw4-pcm-cleanup-allocation' and value['version'] == 1
    assert value['allowCleanupOnly'] is True and value['allowNativeOrDevice'] is False
    assert value['planSHA256'] == digest(plan_path) and value['executorSHA256'] == digest(__file__)
    assert re.fullmatch(r'[0-9a-f-]{36}', value['nonce'])
    now = time.time() * 1000
    assert value['issuedAt'] <= now <= value['expiresAt'] and value['expiresAt'] - value['issuedAt'] <= 300000
    receipt = path.parent / 'cleanup-result.json'
    assert not receipt.exists(), 'This allocation was consumed'
    return value, receipt


def main():
    global DEADLINE
    parser = argparse.ArgumentParser()
    parser.add_argument('--execute', action='store_true')
    parser.add_argument('--allocation')
    parser.add_argument('--allocation-sha256')
    args = parser.parse_args()
    plan_path = HERE / 'plan.json'
    plan = json.loads(plan_path.read_text())
    DEADLINE = time.monotonic() + 120
    value = receipt = None
    if args.execute:
        assert args.allocation and re.fullmatch(r'[0-9a-f]{64}', args.allocation_sha256 or '')
        value, receipt = allocate(args.allocation, args.allocation_sha256, plan_path)
    else:
        assert not args.allocation and not args.allocation_sha256
    pcm, protected, external = check(plan)
    before = os.statvfs(DD).f_bavail * os.statvfs(DD).f_frsize
    if not args.execute:
        print(json.dumps({'checkOnly': True, 'removed': False, 'pcmFiles': len(pcm) - 1, 'candidateAllocatedBytes': 789962752, 'freeBytes': before, 'protectedPodsAndAllProductsVerified': True}))
        return
    result = {'kind': 'slax-aw4-pcm-only-cleanup-result', 'version': 1, 'nonce': value['nonce'], 'planSHA256': digest(plan_path), 'executorSHA256': digest(__file__), 'beforeFreeBytes': before, 'removedFiles': [], 'removed': False, 'error': None}
    receipt.write_text(json.dumps(result, indent=2) + '\n')
    try:
        directory = next(row for row in pcm if row['kind'] == 'directory')
        fd = os.open(CANDIDATE, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            info = os.fstat(fd)
            assert (info.st_ino, info.st_dev) == (directory['inode'], directory['device'])
            for row in pcm:
                if row['kind'] != 'file':
                    continue
                tick()
                validate_row(row)
                os.unlink(Path(row['path']).name, dir_fd=fd)
                result['removedFiles'].append(row['path'])
        finally:
            os.close(fd)
        assert not list(CANDIDATE.iterdir())
        CANDIDATE.rmdir()
        for row in protected:
            validate_row(row, after=True)
        verify_external(external)
        result['removed'] = True
    except Exception as error:
        result['error'] = str(error)
        raise
    finally:
        result['afterFreeBytes'] = os.statvfs(DD).f_bavail * os.statvfs(DD).f_frsize
        result['actualFreeBytesDelta'] = result['afterFreeBytes'] - before
        result['reportedCandidateAllocatedBytes'] = 789962752
        result['nativeCompilerOrDeviceExecuted'] = False
        receipt.write_text(json.dumps(result, indent=2) + '\n')


if __name__ == '__main__':
    main()
