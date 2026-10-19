#!/usr/bin/env python3
"""Prepare by default; a fresh Root grant is required for isolated shell linking."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import plistlib
import re
import selectors
import signal
import stat
import struct
import subprocess
import sys
import time
from uuid import UUID

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[5]
MANIFEST = HERE / 'inputs.json'
PLAN = HERE / 'build-plan.json'
MANIFEST_SHA256 = '95c7053359d56e1e98981e9a2f2e7bb08db30c8fd8f4664f4d3001fdae5328b1'
REPORT_RESERVE = 262144
SDK_FLAGS = ['-Xlinker', '-platform_version', '-Xlinker', 'ios-simulator',
             '-Xlinker', '16.4', '-Xlinker', '26.5']
BUDGET = {'capBytes': 268435456, 'floorBytes': 3221225472,
          'preFreeBytes': 3865470567, 'totalSeconds': 120, 'swiftSeconds': 60,
          'signSeconds': 15, 'verifySeconds': 15, 'inspectSeconds': 15,
          'commandOutputBytes': 8388608, 'recordBytes': REPORT_RESERVE,
          'maximumEntries': 4096, 'monitorSeconds': 0.1}


def require(value, reason):
    if not value:
        raise ValueError(reason)


def public_name(value):
    require(not re.search(r'\.env|\.dev\.vars|credential|secret|private.?key|keystore|GoogleService|google-services',
                          value, re.I), 'Forbidden input/output name')
    return value


def relative(value):
    require(type(value) is str and not value.startswith('/') and
            all(p and p not in ('.', '..') for p in value.split('/')), 'Unsafe relative path')
    return public_name(value)


def regular(path):
    public_name(str(path))
    require(path.is_absolute() and path.resolve() == path, 'Canonical public path required')
    st = path.lstat()
    require(stat.S_ISREG(st.st_mode) and not path.is_symlink(), 'Regular public file required')
    return st


def sha(path, guard=None):
    regular(path)
    result = hashlib.sha256()
    with path.open('rb') as handle:
        for chunk in iter(lambda: handle.read(1048576), b''):
            require(guard is None or guard() is None, 'Resource/deadline stopped hashing')
            result.update(chunk)
    return result.hexdigest()


def bound(item, guard=None):
    require(set(item) >= {'path', 'bytes', 'sha256'} and type(item['bytes']) is int and
            item['bytes'] >= 0 and re.fullmatch('[0-9a-f]{64}', item['sha256']), 'Malformed binding')
    path = Path(item['path'])
    require(regular(path).st_size == item['bytes'] and sha(path, guard) == item['sha256'],
            'Closed public input changed: ' + str(path))


def tree(root, guard=None):
    require(root.is_absolute() and root.resolve() == root and root.is_dir() and not root.is_symlink(),
            'Canonical owned directory required')
    files, directories = {}, []
    for path in root.rglob('*'):
        require(guard is None or guard() is None, 'Guard stopped immutable tree check')
        rel = relative(path.relative_to(root).as_posix())
        st = path.lstat()
        if stat.S_ISDIR(st.st_mode):
            directories.append({'path': rel, 'mode': stat.S_IMODE(st.st_mode)})
        else:
            require(stat.S_ISREG(st.st_mode) and not path.is_symlink(), 'Unexpected immutable tree entry')
            files[rel] = {'path': rel, 'bytes': st.st_size, 'mode': stat.S_IMODE(st.st_mode),
                          'sha256': sha(path, guard)}
        require(len(files) + len(directories) <= BUDGET['maximumEntries'], 'Immutable tree too large')
    return {'files': [files[k] for k in sorted(files)],
            'directories': sorted(directories, key=lambda i: i['path'])}


def checked_inputs(guard=None):
    require(sha(MANIFEST, guard) == MANIFEST_SHA256, 'Frozen manifest changed')
    m = json.loads(MANIFEST.read_bytes())
    require(m['kind'] == 'fresh-source-ios-shell-warm-cache-closed-inputs' and m['version'] == 2 and
            m['budget'] == BUDGET and m['fixtureBundleIdentifier'] == 'app.slax.reader.sourcefixture',
            'Wrong isolated shell scope')
    require(len(m['oldApplication']['tree']['files']) == 109 and len(m['retained113Inputs']) == 113,
            'Historical 109/113 basis changed')
    for item in m['references'] + m['retained113Inputs'] + m['shellSources']:
        bound(item, guard)
    require(tree(Path(m['oldApplication']['path']), guard) == m['oldApplication']['tree'],
            'Source44 app tree changed')
    require(sha(Path(m['rawFramework']['path']), guard) == m['rawFramework']['sha256'], 'Raw J changed')
    sdk = json.loads(Path(m['sdkSettings']['path']).read_bytes())
    require(sdk['Version'] == '26.5' and sdk['CanonicalName'] == 'iphonesimulator26.5' and
            sdk['SupportedTargets']['iphonesimulator']['BuildVersionPlatformID'] == '7', 'Wrong public SDK')
    for tool in m['tools']:
        bound(tool, guard)
        invocation = Path(tool['invocationPath'])
        require(str(invocation.resolve()) == tool['path'] and
                (os.readlink(invocation) if invocation.is_symlink() else None) == tool['invocationSymlinkTarget'],
                'Native invocation alias changed')
    require(plistlib.loads((Path(m['oldApplication']['path']) / 'Info.plist').read_bytes()) == m['info'],
            'Original isolated Info changed')
    require(m['info']['CFBundleIdentifier'] == 'app.slax.reader.sourcefixture' and
            m['info']['UILaunchScreen'] == {} and m['info']['MinimumOSVersion'] == '16.4', 'Wrong isolated Info')
    verify_warm_cache(m, guard)
    return m


def verify_warm_cache(manifest, guard=None):
    item = manifest['warmCache']
    path = Path(item['path'])
    actual = tree(path, guard)
    require(item['regularFiles'] == 101 and item['nestedDirectories'] == 1 and
            len(actual['files']) == 101 and len(actual['directories']) == 1 and
            stat.S_IMODE(path.lstat().st_mode) == item['rootMode'] and actual == item['tree'] and
            sum(i['bytes'] for i in actual['files']) == item['logicalBytes'] and
            hashlib.sha256(json.dumps(actual, sort_keys=True, separators=(',', ':')).encode()).hexdigest() ==
            item['treeSHA256'], 'Closed101-file source warm cache changed')
    return actual


def copy_warm_cache(manifest, destination, guard):
    original = verify_warm_cache(manifest, guard)
    item = manifest['warmCache']
    source_root = Path(item['path'])
    require(not destination.exists() and destination.resolve() == destination, 'Fresh warm-cache destination required')
    require(guard() is None, 'Pre-warm-copy resource guard refused')
    destination.mkdir(mode=item['rootMode'])
    destination.chmod(item['rootMode'])
    for entry in original['directories']:
        target = destination / relative(entry['path'])
        target.mkdir(mode=entry['mode']); target.chmod(entry['mode'])
    for entry in original['files']:
        require(guard() is None, 'Warm-copy resource guard refused')
        origin = source_root / relative(entry['path'])
        regular(origin)
        target = destination / relative(entry['path'])
        with origin.open('rb') as source, target.open('xb') as output:
            for chunk in iter(lambda: source.read(1048576), b''):
                require(guard() is None, 'Warm-copy resource guard refused')
                output.write(chunk)
        target.chmod(entry['mode'])
        require(sha(target, guard) == entry['sha256'], 'Copied warm-cache bytes changed')
    require(tree(destination, guard) == original, 'Copied101 warm-cache tree changed')
    verify_warm_cache(manifest, guard)
    require(guard() is None, 'Final warm-copy resource guard refused')
    return item['treeSHA256']


def version(value):
    return '.'.join(str((value >> shift) & (65535 if shift == 16 else 255)) for shift in (16, 8, 0))


def build_version(path):
    size = regular(path).st_size
    with path.open('rb') as handle:
        header = handle.read(32)
        require(len(header) == 32, 'Short Mach-O header')
        h = struct.unpack('<8I', header)
        require(h[0] == 0xfeedfacf and h[1] == 0x100000c and h[3] == 2 and
                0 < h[4] <= 1024 and h[5] <= 1048576 and 32 + h[5] <= size, 'Thin arm64 executable required')
        data = handle.read(h[5])
    offset, found = 0, []
    for _ in range(h[4]):
        require(offset + 8 <= len(data), 'Truncated load command')
        cmd, length = struct.unpack_from('<II', data, offset)
        require(length >= 8 and length % 8 == 0 and offset + length <= len(data), 'Invalid load command bounds')
        if cmd == 0x32:
            require(length >= 24, 'Short build-version command')
            _, _, platform, minimum, sdk, count = struct.unpack_from('<6I', data, offset)
            require(24 + count * 8 == length, 'Invalid build-version tool entries')
            found.append({'platform': platform, 'minimumOS': version(minimum), 'SDK': version(sdk)})
        offset += length
    require(offset == len(data) and len(found) == 1, 'Exactly one build-version command required')
    return found[0]


def require_current_sdk(path):
    actual = build_version(path)
    require(actual == {'platform': 7, 'minimumOS': '16.4.0', 'SDK': '26.5.0'},
            'Actual linked SDK metadata mismatch; refuse before signing')
    return actual


def resource_status(output, began, expires, pending=0, allow_vanished=False, observation=None):
    if time.monotonic() - began >= BUDGET['totalSeconds'] or int(time.time() * 1000) >= expires:
        return 'deadline'
    disk = os.statvfs(output)
    free = disk.f_bavail * disk.f_frsize
    if observation is not None:
        observation['minimumGlobalAvailableBytes'] = min(observation.get('minimumGlobalAvailableBytes', free), free)
    if free < BUDGET['floorBytes']:
        return 'disk-floor'
    allocated = output.lstat().st_blocks * 512 + ((pending + 4095) // 4096) * 4096 + REPORT_RESERVE
    logical, entries = pending + REPORT_RESERVE, 0
    if allocated > BUDGET['capBytes'] or logical > BUDGET['capBytes']:
        return 'artifact-cap'
    for path in output.rglob('*'):
        entries += 1
        if entries > BUDGET['maximumEntries']:
            return 'entry-cap'
        try:
            st = path.lstat()
        except FileNotFoundError:
            if allow_vanished and path.relative_to(output).parts[0] in ('swift-module-cache', 'temporary'):
                continue
            raise
        if not stat.S_ISREG(st.st_mode) and not stat.S_ISDIR(st.st_mode):
            if observation is not None and 'firstUnexpectedOwnedEntry' not in observation:
                record = {'relativePath': path.relative_to(output).as_posix(),
                          'mode': stat.S_IMODE(st.st_mode), 'typeBits': stat.S_IFMT(st.st_mode),
                          'bytes': st.st_size, 'allocatedBytes': st.st_blocks * 512,
                          'mtimeNs': st.st_mtime_ns, 'symlink': stat.S_ISLNK(st.st_mode),
                          'targetFollowed': False}
                if stat.S_ISLNK(st.st_mode):
                    try:
                        target = os.readlink(path)
                        record['readlink'] = target[:4096]
                        record['readlinkTruncated'] = len(target) > 4096
                    except OSError as error:
                        record['readlinkErrorType'] = type(error).__name__
                observation['firstUnexpectedOwnedEntry'] = record
            return 'unexpected-owned-entry'
        allocated += st.st_blocks * 512
        if stat.S_ISREG(st.st_mode):
            logical += st.st_size
        if allocated > BUDGET['capBytes'] or logical > BUDGET['capBytes']:
            return 'artifact-cap'
    if observation is not None:
        observation['maximumAllocatedPlusPendingAndRecordReserveBytes'] = max(
            observation.get('maximumAllocatedPlusPendingAndRecordReserveBytes', 0), allocated)
        observation['maximumLogicalPlusPendingAndRecordReserveBytes'] = max(
            observation.get('maximumLogicalPlusPendingAndRecordReserveBytes', 0), logical)
        observation['lastActualAllocatedBytes'] = allocated - REPORT_RESERVE - ((pending + 4095) // 4096) * 4096
        observation['lastActualLogicalBytes'] = logical - REPORT_RESERVE - pending
    return None


def allocation(path, expected_sha, manifest):
    require(path == Path(manifest['allocationPath']) and path.is_relative_to(ROOT),
            'Exact local Root allocation required')
    require(re.fullmatch('[0-9a-f]{64}', expected_sha) and sha(path) == expected_sha and
            regular(path).st_size <= 16384, 'Root allocation digest/size mismatch')
    value = json.loads(path.read_bytes())
    expected = {'kind': 'root-one-fresh-source-swift-shell-warm-cache-build-allocation', 'version': 2,
                'outputRoot': manifest['outputRoot'], 'manifestSHA256': MANIFEST_SHA256,
                'executorSHA256': sha(Path(__file__).resolve()), 'planSHA256': sha(PLAN),
                'oldSource44ShellSHA256': 'a3fde1b120433684d1faee39e55eddb451c699fa1a3ca3695bbe25b31a29f672',
                'rawJMachOSHA256': '1bc0873e19287f6b8cfc99bb9106d124e67a1343bfc06e227f0bce93ce9da38d',
                'warmCacheTreeSHA256': manifest['warmCache']['treeSHA256'],
                'budget': BUDGET, 'exclusiveNativeBuildSlot': True, 'allowSwiftShellOnly': True,
                'allowFreshSimulatorAdhocSigningOnly': True, 'allowControlOrKmpBuild': False,
                'allowDeviceOrDatabaseOrMetro': False, 'allowOldArtifactMutationOrCleanup': False}
    require(set(value) == set(expected) | {'nonce', 'requestedAt', 'expiresAt'} and
            all(type(value.get(k)) is type(v) and value.get(k) == v for k, v in expected.items()), 'Wrong grant scope')
    UUID(value['nonce'])
    now = int(time.time() * 1000)
    require(type(value['requestedAt']) is int and type(value['expiresAt']) is int and
            value['requestedAt'] <= now < value['expiresAt'] <= value['requestedAt'] + 600000, 'Expired grant')
    output = Path(value['outputRoot'])
    require(output.parent == Path('/private/tmp') and output.resolve() == output and not output.exists() and
            re.fullmatch(r'slax-source-fresh-shell-warm-build-[0-9a-f-]{36}', output.name), 'Fresh isolated output required')
    UUID(output.name[len('slax-source-fresh-shell-warm-build-'):])
    disk = os.statvfs(output.parent)
    require(disk.f_bavail * disk.f_frsize >= BUDGET['preFreeBytes'], '3GiB plus0.6GiB reserve required')
    return value


def bounded_command(args, environment, output, seconds, guard):
    require(guard() is None, 'Pre-command guard refused')
    process = subprocess.Popen(args, cwd=output, env=environment, stdin=subprocess.DEVNULL,
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
    deadline = time.monotonic() + seconds
    buffers = [bytearray(), bytearray()]
    stopped = None
    def monitor():
        try:
            return guard(pending=sum(len(b) for b in buffers), allow_vanished=True)
        except Exception as error:
            return 'monitor-error:' + type(error).__name__
    try:
        with selectors.DefaultSelector() as selector:
            selector.register(process.stdout, selectors.EVENT_READ, buffers[0])
            selector.register(process.stderr, selectors.EVENT_READ, buffers[1])
            while selector.get_map() or process.poll() is None:
                stopped = monitor()
                remaining = deadline - time.monotonic()
                if stopped or remaining <= 0:
                    stopped = stopped or 'command-timeout'
                    break
                for key, _ in selector.select(min(BUDGET['monitorSeconds'], remaining)):
                    data = os.read(key.fileobj.fileno(), 8192)
                    if not data:
                        selector.unregister(key.fileobj)
                        continue
                    left = BUDGET['commandOutputBytes'] - sum(len(b) for b in buffers)
                    key.data.extend(data[:left])
                    if len(data) > left:
                        stopped = 'command-output-cap'
                        break
                if stopped:
                    break
    except Exception as error:
        stopped = 'command-observer-error:' + type(error).__name__
    finally:
        if process.poll() is None:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            try:
                process.wait(timeout=1)
            except subprocess.TimeoutExpired:
                stopped = 'own-child-termination-unconfirmed'
        process.stdout.close()
        process.stderr.close()
    return process.returncode, bytes(buffers[0]), bytes(buffers[1]), stopped


def execute(path, grant_sha):
    manifest = checked_inputs()
    grant = allocation(path, grant_sha, manifest)
    output = Path(grant['outputRoot'])
    before = os.statvfs(output.parent)
    available_before = before.f_bavail * before.f_frsize
    require(available_before >= BUDGET['preFreeBytes'], 'Pre-copy reserve changed')
    output.mkdir(mode=0o700)
    began = time.monotonic()
    observations, commands = {}, []
    report = {'kind': 'fresh-source-ios-swift-shell-warm-cache-build-result', 'version': 2,
              'status': 'started', 'warmCacheCopied': False, 'oldWarmCacheUnchanged': False, 'grantSHA256': grant_sha, 'manifestSHA256': MANIFEST_SHA256,
              'executorSHA256': sha(Path(__file__).resolve()), 'commands': commands,
              'resources': observations, 'deviceExecuted': False, 'native240Accepted': False,
              'databaseRead': False, 'directKotlinCallbackCaptured': False, 'visualParityAccepted': False,
              'allCompilerOrServiceProcessesStoppedVerified': False,
              'initialGlobalAvailableBytes': available_before}
    def guard(**kwargs):
        return resource_status(output, began, grant['expiresAt'], observation=observations, **kwargs)
    def record(name, value):
        data = (json.dumps(value, indent=2) + '\n').encode()
        require(len(data) <= REPORT_RESERVE, 'Record cap exceeded')
        (output / name).write_bytes(data)
    def run(args, label, maximum):
        require(guard() is None, 'Guard rejected next command')
        left = min(maximum, BUDGET['totalSeconds'] - (time.monotonic() - began),
                   (grant['expiresAt'] - int(time.time() * 1000)) / 1000)
        require(left > 0, 'Command deadline exhausted')
        code, stdout, stderr, stopped = bounded_command(args, environment, output, left, guard)
        (output / (label + '.stdout')).write_bytes(stdout)
        (output / (label + '.stderr')).write_bytes(stderr)
        commands.append({'label': label, 'argv': args, 'exitCode': code, 'stopped': stopped,
                         'stdoutSHA256': hashlib.sha256(stdout).hexdigest(),
                         'stderrSHA256': hashlib.sha256(stderr).hexdigest()})
        require(code == 0 and stopped is None, 'Command failed/stopped; no retry')
        require(guard() is None, 'Stopped-process strict guard refused')
        return stdout, stderr
    environment = {'PATH': '/usr/bin:/bin', 'LANG': 'C', 'DEVELOPER_DIR': manifest['developerDirectory'],
                   'TMPDIR': str(output / 'temporary')}
    try:
        record('owner.json', grant)
        record('closed-inputs.json', manifest)
        app = output / 'SlaxSourceFixtureApp.app'
        app.mkdir()
        for item in manifest['oldApplication']['tree']['directories']:
            (app / item['path']).mkdir(mode=item['mode'])
        for item in manifest['oldApplication']['tree']['files']:
            require(guard() is None, 'Copy guard refused')
            origin = Path(manifest['oldApplication']['path']) / item['path']
            destination = app / item['path']
            with origin.open('rb') as source, destination.open('xb') as target:
                for chunk in iter(lambda: source.read(1048576), b''):
                    require(guard() is None, 'Copy guard refused')
                    target.write(chunk)
            destination.chmod(item['mode'])
            require(sha(destination, guard) == item['sha256'], 'Copied app input mismatch')
        require(tree(app, guard) == manifest['oldApplication']['tree'], 'Copied full109 app changed')
        shell = output / 'shell'
        shell.mkdir()
        for item in manifest['shellSources']:
            destination = shell / item['destination']
            destination.write_bytes(Path(item['path']).read_bytes())
            require(sha(destination, guard) == item['sha256'], 'Copied shell source changed')
        (output / 'temporary').mkdir()
        cache = output / 'swift-module-cache'
        report['warmCacheSourceTreeSHA256'] = copy_warm_cache(manifest, cache, guard)
        report['warmCacheCopied'] = True
        tools = {i['id']: i['invocationPath'] for i in manifest['tools']}
        executable = app / 'SlaxSourceFixtureApp'
        args = [tools['swiftc'], '-parse-as-library', '-swift-version', '5', '-target',
                'arm64-apple-ios16.4-simulator', '-sdk', manifest['sdkPath'], '-module-cache-path', str(cache),
                '-Xcc', '-fmodules-cache-path=' + str(cache), '-F', manifest['rawFrameworkParent'],
                '-framework', 'SlaxSourceFixture', '-framework', 'UIKit', '-framework', 'Foundation',
                '-framework', 'WebKit', '-Xlinker', '-rpath', '-Xlinker', '@executable_path/Frameworks']
        args += SDK_FLAGS + [str(shell / 'main.swift'), str(shell / 'FixtureReaderStep.swift'), '-o', str(executable)]
        run(args, 'compile-fresh-shell', BUDGET['swiftSeconds'])
        report['actualLinkedBuildVersionBeforeSigning'] = require_current_sdk(executable)
        require(sha(app / 'Info.plist', guard) == manifest['infoSHA256'], 'Info changed before signing')
        assert_retained_files(app, manifest, guard, signing=False)
        run([tools['codesign'], '--force', '--sign', '-', str(app)], 'sign-fresh-app-ad-hoc', BUDGET['signSeconds'])
        run([tools['codesign'], '--verify', '--deep', '--strict', str(app)], 'verify-fresh-app', BUDGET['verifySeconds'])
        stdout, _ = run([tools['codesign'], '--display', '--entitlements', ':-', str(app)],
                        'inspect-fresh-app-entitlements', BUDGET['inspectSeconds'])
        require(not stdout.strip() or plistlib.loads(stdout) == {}, 'Isolated fixture must have no entitlements')
        report['actualLinkedBuildVersionAfterSigning'] = require_current_sdk(executable)
        assert_retained_files(app, manifest, guard, signing=True)
        checked_inputs(guard)
        report['oldWarmCacheUnchanged'] = True
        require(guard() is None, 'Final strict resource guard refused')
        report.update(status='fresh-shell-built-signed-verified-no-device', appPath=str(app),
                      signedApplicationTree=tree(app, guard), shellSourcesUnchanged=True,
                      oldSource44AndOriginalJUnchanged=True, controlBuildPerformed=False,
                      exactHistorical33SectionsBasis=manifest['historical33SectionsRootReview'],
                      frameworkPreservation='Every copied signed framework file remains byte-identical; raw J digest unchanged. Referenced prior Root33-section proof remains historical.')
        report['elapsedSeconds'] = time.monotonic() - began
        record('report.json', report)
        require(guard() is None, 'Final report accounting refused')
        return report
    except Exception as error:
        # A refused generated entry must not suppress the protected source-cache
        # hash check. This read-only check still observes the same time/floor;
        # when its window is exhausted, preserve unknown rather than claiming it.
        def protected_cache_guard():
            if time.monotonic() - began >= BUDGET['totalSeconds'] or int(time.time() * 1000) >= grant['expiresAt']:
                return 'deadline'
            disk = os.statvfs(output)
            if disk.f_bavail * disk.f_frsize < BUDGET['floorBytes']:
                return 'disk-floor'
            return None
        try:
            verify_warm_cache(manifest, protected_cache_guard)
            report['oldWarmCacheUnchanged'] = True
        except Exception as cache_error:
            report['oldWarmCacheFinalVerificationRefusal'] = type(cache_error).__name__ + ': ' + str(cache_error)
        report.update(status='failed', refusal=type(error).__name__ + ': ' + str(error),
                      elapsedSeconds=time.monotonic() - began)
        record('failure.json', report)
        if (output / 'report.json').exists():
            record('report.json', report)
        raise


def assert_retained_files(app, manifest, guard, signing):
    actual = tree(app, guard)
    original = manifest['oldApplication']['tree']
    require(actual['directories'] == original['directories'] and
            {i['path'] for i in actual['files']} == {i['path'] for i in original['files']},
            'Fresh app added/removed an unapproved entry')
    permitted = {'SlaxSourceFixtureApp'} | ({'_CodeSignature/CodeResources'} if signing else set())
    before = {i['path']: i for i in original['files']}
    for item in actual['files']:
        if item['path'] not in permitted:
            require(item == before[item['path']], 'Retained Info/J/resource file changed')


def main():
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument('--execute', action='store_true')
    parser.add_argument('--allocation')
    parser.add_argument('--allocation-sha256')
    args = parser.parse_args()
    if args.execute:
        require(args.allocation and args.allocation_sha256, 'Explicit new Root grant and SHA required')
        result = execute(Path(args.allocation), args.allocation_sha256)
        print(json.dumps({'status': result['status'], 'appPath': result['appPath'], 'deviceExecuted': False}))
    else:
        require(not args.allocation and not args.allocation_sha256, 'Grant fields require explicit execution')
        m = checked_inputs()
        print(json.dumps({'status': 'readonly-admission-only', 'oldApplicationFiles': 109,
                          'retainedInputs': len(m['retained113Inputs']), 'warmCacheFiles': 101, 'warmCacheCopyPerformed': False, 'deviceExecuted': False,
                          'nativeToolsInvoked': False, 'native240Accepted': False}))


if __name__ == '__main__':
    main()
