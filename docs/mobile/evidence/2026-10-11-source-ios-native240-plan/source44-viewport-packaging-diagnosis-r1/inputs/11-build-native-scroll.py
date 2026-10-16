#!/usr/bin/env python3
"""Prepared bounded Swift/XCTest build only; never invoke a device or Kotlin build."""
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
import time
import uuid

ROOT = Path(__file__).resolve().parents[5]
HERE = ROOT / 'docs/mobile/evidence/2026-10-11-source-ios-native240-plan/bounded-shell-control-build-r3'
INPUTS_SHA256 = '6c22360986c860aeb4a6bf20b6ac78958d48258a45bae2f296c05f7b8cb77b9f'


def require(value, reason):
    if not value:
        raise ValueError(reason)


def regular(path):
    require(path.is_file() and not path.is_symlink() and path.resolve() == path,
        'Canonical regular public file required: ' + str(path))
    return path


def digest(path, guard=None):
    result = hashlib.sha256()
    with regular(path).open('rb') as handle:
        for part in iter(lambda: handle.read(1024 * 1024), b''):
            require(guard is None or guard() is None, 'Bounded resource/window guard stopped hashing')
            result.update(part)
    return result.hexdigest()


def relative(value):
    parts = value.split('/')
    require(not value.startswith('/') and all(part and part not in ('.', '..') for part in parts), 'Unsafe output path')
    require(not re.search(r'\.env|\.dev\.vars|credential|secret|private.?key|keystore|GoogleService|google-services', value, re.I),
        'Forbidden public input/output path')
    return value


def checked_inputs(guard=None):
    require(digest(HERE / 'inputs.json', guard) == INPUTS_SHA256, 'The reviewed closed input manifest changed')
    manifest = json.loads((HERE / 'inputs.json').read_bytes())
    require(manifest['kind'] == 'slax-source-native-scroll-shell-control-closed-inputs' and manifest['version'] == 3,
        'Wrong source fixture manifest')
    require(len(manifest['inputs']) == 113 and len({item['destination'] for item in manifest['inputs']}) == 113,
        'The exact copy-input set is required')
    source = Path(manifest['sourceRoot'])
    marker = source / 'slax-source-fixture.json'
    require(digest(marker, guard) == manifest['baseMarkerSHA256'], 'Historical source-j marker changed')
    historical = json.loads(marker.read_bytes())
    require(historical['controlledFixture'] and historical['copiedPinnedFiles'] == 356
        and historical['sourceCheckoutModified'] is False and historical['originalBuildConfigurationCopied'] is False
        and historical['bundleIdentifier'] == 'app.slax.reader.sourcefixture', 'Wrong original fixture provenance')
    original_manifest = json.loads((ROOT / 'docs/mobile/source-manifest.json').read_bytes())
    require(len(original_manifest['files']) == 356 and len(historical['overlayDigests']) == 55, 'Original source closure changed')
    for item in original_manifest['files'] + historical['overlayDigests']:
        require(digest(source / relative(item['path']), guard) == item['sha256'], 'Historical source-j input changed')
    for item in manifest['inputs'] + manifest['references']:
        path = Path(item['path'])
        require(digest(path, guard) == item['sha256'], 'Closed public input changed: ' + str(path))
        if 'bytes' in item:
            require(path.stat().st_size == item['bytes'], 'Public input length changed')
        if 'destination' in item:
            relative(item['destination'])
    for group, base in [('framework', source / 'composeApp/build/bin/iosSimulatorArm64/debugFramework/SlaxSourceFixture.framework'),
        ('compose-resources', source / 'composeApp/build/generated/compose/resourceGenerator/preparedResources/commonMain/composeResources')]:
        actual = {str(path) for path in base.rglob('*') if path.is_file() or path.is_symlink()}
        declared = {item['path'] for item in manifest['inputs'] if item['group'] == group}
        require(actual == declared, 'Framework/resource closed file set changed')
    for tool in manifest['tools']:
        invocation = Path(tool['invocationPath'])
        require(str(invocation.resolve()) == tool['path'] and digest(Path(tool['path']), guard) == tool['sha256'], 'Native tool changed')
        require((os.readlink(invocation) if invocation.is_symlink() else None) == tool['invocationSymlinkTarget'], 'Native tool alias changed')
    require(manifest['fixtureBundleIdentifier'] == 'app.slax.reader.sourcefixture'
        and manifest['fixtureInputSHA256'] == 'aaf4fdd7fd8b205ed6f2e297686f20bb3f523b680d35fc62effcdc8a2a4afe2f', 'Wrong canonical bundle')
    return manifest


def owned_allocation(path, output, manifest):
    require(output.parent == Path('/private/tmp') and not output.exists() and not output.is_symlink()
        and re.fullmatch(r'slax-source-native-scroll-build-[0-9a-f-]{36}', output.name), 'Fresh exact owned output required')
    uuid.UUID(output.name.removeprefix('slax-source-native-scroll-build-'))
    require(path.is_relative_to(ROOT / 'docs/mobile/evidence'), 'Root allocation must be a local evidence record')
    grant = json.loads(regular(path).read_bytes())
    now = int(time.time() * 1000)
    expected = {'kind': 'slax-root-source-native-scroll-build-allocation', 'version': 3,
        'outputRoot': str(output), 'inputsSHA256': INPUTS_SHA256, 'executorSHA256': digest(Path(__file__).resolve()),
        'sourceBaseMarkerSHA256': manifest['baseMarkerSHA256'], 'rawFrameworkMachOSHA256': manifest['rawFrameworkMachOSHA256'],
        'fixtureInputSHA256': manifest['fixtureInputSHA256'], 'exclusiveNativeSlot': True, 'allowSwiftAndXCTestBuildOnly': True,
        'allowKmpOrGradle': False, 'allowDeviceCommands': False, 'allowMetroCommands': False, 'allowGlobalCleanup': False}
    require(all(type(grant.get(key)) is type(value) and grant.get(key) == value for key, value in expected.items()), 'Missing or mismatched explicit Root allocation')
    require(set(grant) == set(expected) | {'nonce', 'requestedAt', 'expiresAt'}, 'Unknown allocation fields')
    uuid.UUID(grant['nonce'])
    require(type(grant['requestedAt']) is int and type(grant['expiresAt']) is int
        and grant['requestedAt'] <= now < grant['expiresAt'] <= grant['requestedAt'] + 600000, 'Expired build allocation')
    stats = os.statvfs(output.parent)
    require(stats.f_bavail * stats.f_frsize >= manifest['budget']['minimumFreeBeforeBytes'], '3-GiB plus0.6-GiB pre-build reserve required')
    return grant


def resource_status(output, budget, observation=None, allow_vanished_generated=False):
    stats = os.statvfs(output)
    free = stats.f_bavail * stats.f_frsize
    if observation is not None:
        observation['minimumFreeObservedBytes'] = min(observation.get('minimumFreeObservedBytes', free), free)
    if free < budget['minimumFreeDuringBytes']:
        return 'disk-floor'
    allocated, products = 0, 0
    for path in output.rglob('*'):
        try:
            status = path.lstat()
        except FileNotFoundError:
            # A running compiler may atomically rename its temporary files.
            # Copied inputs and the final, stopped-process scan remain strict.
            generated = path.relative_to(output).parts[0] in ('swift-module-cache', 'derived-data')
            if allow_vanished_generated and generated:
                continue
            raise
        allocated += status.st_blocks * 512
        if stat.S_ISLNK(status.st_mode):
            if not path.resolve().is_relative_to(output):
                return 'external-generated-symlink'
            continue
        if not stat.S_ISREG(status.st_mode) and not stat.S_ISDIR(status.st_mode):
            return 'unexpected-special-owned-file'
        if stat.S_ISREG(status.st_mode):
            rel = path.relative_to(output).as_posix()
            if rel.startswith('SlaxSourceFixtureApp.app/') or rel.startswith('derived-data/Build/Products/'):
                products += status.st_size
            # SDK stat caches can be sparse. Their actual blocks still count in
            # the hard total bound; only this owned cache path may be larger.
            sparse_stat = rel.startswith('derived-data/SDKStatCaches.noindex/') and rel.endswith('.sdkstatcache')
            if status.st_size > budget['maximumNewProductLogicalBytes'] and not sparse_stat:
                return 'unexpected-large-owned-file'
        if observation is not None:
            observation['maximumAllocatedObservedBytes'] = max(observation.get('maximumAllocatedObservedBytes', 0), allocated)
            observation['maximumProductLogicalObservedBytes'] = max(observation.get('maximumProductLogicalObservedBytes', 0), products)
        if allocated > budget['maximumNewAllocatedBytes'] or products > budget['maximumNewProductLogicalBytes']:
            return 'new-artifact-cap'
    return None


def bounded_command(args, environment, cwd, timeout, cap, resources):
    def observe_resources():
        try:
            return resources()
        except Exception as error:
            # Refuse unexpected monitor failures while retaining captured
            # output and the command receipt after stopping our own group.
            return 'monitor-error:' + type(error).__name__

    require(observe_resources() is None, 'Resource guard rejected command before invocation')
    process = subprocess.Popen(args, cwd=cwd, env=environment, stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
    deadline = time.monotonic() + timeout
    stdout, stderr, stopped = bytearray(), bytearray(), None
    try:
        with selectors.DefaultSelector() as selector:
            selector.register(process.stdout, selectors.EVENT_READ, stdout)
            selector.register(process.stderr, selectors.EVENT_READ, stderr)
            while selector.get_map():
                stopped = observe_resources()
                remaining = deadline - time.monotonic()
                if stopped or remaining <= 0:
                    stopped = stopped or 'timeout'; break
                for key, _ in selector.select(min(0.1, remaining)):
                    data = os.read(key.fileobj.fileno(), 8192)
                    if not data:
                        selector.unregister(key.fileobj); continue
                    available = cap - len(stdout) - len(stderr)
                    key.data.extend(data[:available])
                    if len(data) > available:
                        stopped = 'output-cap'; break
                if stopped:
                    break
            while not stopped and process.poll() is None:
                stopped = observe_resources()
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    stopped = 'timeout'
                elif not stopped:
                    time.sleep(min(0.05, remaining))
        if stopped:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        process.wait(timeout=1)
    finally:
        if process.poll() is None:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            process.wait(timeout=1)
        process.stdout.close(); process.stderr.close()
    return process.returncode, bytes(stdout), bytes(stderr), stopped or observe_resources()


def macho_sections(path):
    data = regular(path).read_bytes()
    require(data[:4] == b'\xcf\xfa\xed\xfe', 'Expected real arm64 MachO64')
    position, result = 32, {}
    for _ in range(struct.unpack_from('<I', data, 16)[0]):
        command, size = struct.unpack_from('<II', data, position)
        require(size >= 8 and position + size <= len(data), 'Invalid MachO command bounds')
        if command == 0x19:
            for index in range(struct.unpack_from('<I', data, position + 64)[0]):
                section = position + 72 + index * 80
                name = data[section:section + 16].split(b'\0')[0].decode()
                segment = data[section + 16:section + 32].split(b'\0')[0].decode()
                length = struct.unpack_from('<Q', data, section + 40)[0]
                offset = struct.unpack_from('<I', data, section + 48)[0]
                kind = struct.unpack_from('<I', data, section + 64)[0] & 0xff
                if length and offset and kind not in (1, 12, 18):
                    require(offset + length <= len(data), 'Invalid section bounds')
                    result[segment + '/' + name] = hashlib.sha256(data[offset:offset + length]).hexdigest()
        position += size
    require(len(result) == 33, 'The exact original33 file-backed sections are required')
    return result


def execute(output, allocation):
    manifest = checked_inputs()
    grant = owned_allocation(allocation, output, manifest)
    output.mkdir()
    began = time.monotonic()
    budget, commands, resource_observation = manifest['budget'], [], {}
    report = {'kind': 'slax-source-native-scroll-shell-control-build-result', 'version': 3,
        'nonce': grant['nonce'], 'inputsSHA256': INPUTS_SHA256, 'status': 'started-build-only', 'commands': commands,
        'deviceCommands': False, 'kmpOrGradleCommands': False, 'metroCommands': False, 'native240Accepted': False, 'resourceObservation': resource_observation}
    (output / 'owner.json').write_text(json.dumps(grant, indent=2) + '\n')
    environment = {'PATH': '/usr/bin:/bin', 'LANG': 'C', 'DEVELOPER_DIR': manifest['developerDirectory'],
        'TMPDIR': str(output / 'temporary')}
    (output / 'temporary').mkdir()

    def guard(allow_vanished_generated=False):
        if time.monotonic() - began >= budget['maximumTotalSeconds'] or int(time.time() * 1000) >= grant['expiresAt']:
            return 'total-window-expired'
        return resource_status(output, budget, resource_observation, allow_vanished_generated)

    def run(args, label, timeout):
        checked_inputs(guard)
        require(guard() is None, 'Bounded build guard rejected the next command')
        left = min(timeout, budget['maximumTotalSeconds'] - (time.monotonic() - began), (grant['expiresAt'] - int(time.time() * 1000)) / 1000)
        require(left > 0, 'Native build window expired')
        code, stdout, stderr, stopped = bounded_command(args, environment, output, left,
            budget['maximumOutputBytesPerCommand'], lambda: guard(allow_vanished_generated=True))
        (output / (label + '.stdout')).write_bytes(stdout); (output / (label + '.stderr')).write_bytes(stderr)
        commands.append({'label': label, 'argv': args, 'exitCode': code, 'stopped': stopped,
            'stdoutSHA256': hashlib.sha256(stdout).hexdigest(), 'stderrSHA256': hashlib.sha256(stderr).hexdigest()})
        require(code == 0 and stopped is None, 'Native command failed/stopped; preserve owned records, never retry')
        require(guard() is None, 'Stopped-process full accounting rejected command products')

    try:
        for item in manifest['inputs']:
            require(guard() is None, 'Build guard stopped input copying')
            target = output / relative(item['destination'])
            require(not target.exists(), 'Refuse to overwrite owned input')
            target.parent.mkdir(parents=True, exist_ok=True)
            with regular(Path(item['path'])).open('rb') as source, target.open('xb') as destination:
                for part in iter(lambda: source.read(1024 * 1024), b''):
                    require(guard() is None, 'Build guard stopped input copying')
                    destination.write(part)
            require(digest(target, guard) == item['sha256'], 'Copied public input digest mismatch')
        app = output / 'SlaxSourceFixtureApp.app'
        require(plistlib.loads((app / 'Info.plist').read_bytes())['CFBundleIdentifier'] == 'app.slax.reader.sourcefixture', 'Wrong source app identity')
        module_cache = output / 'swift-module-cache'; module_cache.mkdir()
        tools = {item['id']: item['invocationPath'] for item in manifest['tools']}
        framework_parent = str(Path(manifest['sourceRoot']) / 'composeApp/build/bin/iosSimulatorArm64/debugFramework')
        run([tools['swiftc'], '-parse-as-library', '-swift-version', '5', '-target', 'arm64-apple-ios16.4-simulator', '-sdk', manifest['sdkPath'],
            '-module-cache-path', str(module_cache), '-Xcc', '-fmodules-cache-path=' + str(module_cache),
            '-F', framework_parent, '-framework', 'SlaxSourceFixture', '-framework', 'UIKit', '-framework', 'Foundation', '-framework', 'WebKit',
            '-Xlinker', '-rpath', '-Xlinker', '@executable_path/Frameworks', str(output / 'shell/main.swift'),
            str(output / 'shell/FixtureReaderStep.swift'), '-o', str(app / 'SlaxSourceFixtureApp')], 'compile-source-swift-shell', budget['swiftSeconds'])
        packaged = app / 'Frameworks/SlaxSourceFixture.framework'
        run([tools['codesign'], '--force', '--sign', '-', str(packaged)], 'sign-copied-framework-ad-hoc', budget['otherCommandSeconds'])
        run([tools['codesign'], '--force', '--sign', '-', str(app)], 'sign-isolated-source-app-ad-hoc', budget['otherCommandSeconds'])
        run([tools['codesign'], '--verify', '--deep', '--strict', str(app)], 'verify-isolated-source-app', budget['otherCommandSeconds'])
        raw = Path(manifest['sourceRoot']) / 'composeApp/build/bin/iosSimulatorArm64/debugFramework/SlaxSourceFixture.framework/SlaxSourceFixture'
        require(macho_sections(raw) == macho_sections(packaged / 'SlaxSourceFixture'), 'Ad-hoc packaging changed original file-backed sections')
        derived = output / 'derived-data'
        run([tools['xcodebuild'], 'build-for-testing', '-project', str(output / 'control/SourceFixtureControl.xcodeproj'),
            '-scheme', 'SourceFixtureControl', '-configuration', 'Debug', '-sdk', 'iphonesimulator',
            '-destination', 'generic/platform=iOS Simulator', '-derivedDataPath', str(derived), '-jobs', '1',
            'ARCHS=arm64', 'ONLY_ACTIVE_ARCH=YES', 'CODE_SIGNING_ALLOWED=NO', 'COMPILER_INDEX_STORE_ENABLE=NO',
            'CLANG_ENABLE_COMPILE_CACHE=NO', 'SWIFT_ENABLE_COMPILE_CACHE=NO', 'COMPILATION_CACHE_ENABLE_CACHING=NO', 'CLANG_MODULE_CACHE_PATH=' + str(derived / 'ModuleCache.noindex'),
            'MODULE_CACHE_DIR=' + str(derived / 'ModuleCache.noindex'),
            'SDK_STAT_CACHE_DIR=' + str(derived / 'SDKStatCaches.noindex')], 'build-native-scroll-control-only', budget['xcodebuildSeconds'])
        checked_inputs(guard)
        require(guard() is None, 'Final build resource/window guard rejected products')
        require(digest(raw, guard) == manifest['rawFrameworkMachOSHA256'], 'Original raw-j framework changed')
        report.update(status='swift-shell-and-xctest-built-no-device-execution', originalFileBackedSectionsUnchanged=33,
            appPath=str(app), executableSHA256=digest(app / 'SlaxSourceFixtureApp', guard),
            packagedFrameworkSHA256=digest(packaged / 'SlaxSourceFixture', guard),
            testRunFiles=[str(path.relative_to(output)) for path in derived.rglob('*.xctestrun')],
            unsignedControlProducts='Built for testing without signing or device execution; a subsequent allocated test window must bind and inspect them.')
        report['regularProducts'] = {}
        for path in output.rglob('*'):
            require(guard() is None, 'Final artifact record guard stopped hashing')
            if path.is_file() and not path.is_symlink():
                report['regularProducts'][str(path.relative_to(output))] = {'bytes': path.stat().st_size, 'sha256': digest(path, guard)}
        report['elapsedSeconds'] = time.monotonic() - began
        disk = os.statvfs(output)
        report['freeBeforeReportBytes'] = disk.f_bavail * disk.f_frsize
        serialized = (json.dumps(report, indent=2) + '\n').encode()
        require(len(serialized) <= 1024 * 1024, 'Final artifact record unexpectedly large')
        require(guard() is None, 'Final resource/window guard rejected report')
        (output / 'report.json').write_bytes(serialized)
        require(guard() is None, 'Final resource/window guard rejected recorded result')
    except BaseException as error:
        report.update(status='failed-build-preserved-no-retry', elapsedSeconds=time.monotonic() - began, error=type(error).__name__ + ': ' + str(error))
        completed_record = output / 'report.json'
        if completed_record.exists():
            completed_record.rename(output / 'rejected-completed-record.json')
        try:
            (output / 'failure.json').write_text(json.dumps(report, indent=2) + '\n')
        except OSError as record_error:
            report['failureRecordError'] = type(record_error).__name__
            print(json.dumps(report))
        print(json.dumps({'status': report['status'], 'outputRoot': str(output), 'noDeviceOrKmp': True}))
        raise
    print(json.dumps({'status': report['status'], 'report': str(output / 'report.json'), 'noDeviceOrKmp': True}))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--execute', action='store_true')
    parser.add_argument('--output-root')
    parser.add_argument('--allocation-file')
    arguments = parser.parse_args()
    if arguments.execute:
        require(arguments.output_root and arguments.allocation_file, 'Fresh explicit Root allocation and output required')
        execute(Path(arguments.output_root).absolute(), Path(arguments.allocation_file).absolute())
    else:
        manifest = checked_inputs()
        print(json.dumps({'status': 'prepared-closed-inputs-verified-no-command-execution', 'inputsSHA256': INPUTS_SHA256,
            'copyInputs': len(manifest['inputs']), 'compilerOrDeviceExecuted': False}))


if __name__ == '__main__':
    main()
