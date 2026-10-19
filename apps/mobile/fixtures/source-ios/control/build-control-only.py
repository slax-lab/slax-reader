#!/usr/bin/env python3
"""Build only the retained Source44 XCTest control, never rebuild its signed app."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import plistlib
import re
import stat
import struct
import time
import uuid

ROOT = Path(__file__).resolve().parents[5]
HERE = ROOT / 'retired-evidence'
BASIS_SHA256 = 'a1b2e7ecd628f2ee25c3f3dfbe1a21bdaa08341401cbc8bbb0a35f1d82ccec49'
PREVIOUS_EXECUTOR_SHA256 = '040e3d55c2faf13efb7d2f3e8039c3b8a9893bdd4567f46e25384b50b8fd0d5b'
CORE_PATH = ROOT / 'apps/mobile/fixtures/source-ios/control/build-native-scroll.py'
if hashlib.sha256(CORE_PATH.read_bytes()).hexdigest() != PREVIOUS_EXECUTOR_SHA256:
    raise ValueError('The reviewed previous monitor executor changed before import')
spec = importlib.util.spec_from_file_location('source_control_previous_monitor', CORE_PATH)
core = importlib.util.module_from_spec(spec)
spec.loader.exec_module(core)


def checked_basis(guard=None):
    core.require(core.digest(HERE / 'input-basis.json', guard) == BASIS_SHA256, 'The exact retained Source44 basis changed')
    basis = json.loads((HERE / 'input-basis.json').read_bytes())
    original = core.checked_inputs(guard)
    core.require(basis['kind'] == 'slax-source-native-scroll-control-only-basis' and basis['version'] == 4
        and len(basis['retainedCopyInputs']) == 113 and len(basis['signedAppFileManifest']) == 109,
        'Wrong retained source/control closure')
    source = Path(basis['sourceRoot'])
    core.require(str(source) == '/private/tmp/slax-source-native-scroll-build-44e898c8-341b-4b07-b7d1-05be69d2b8b1'
        and source.resolve() == source and source.is_dir() and not source.is_symlink(), 'Wrong immutable Source44 root')
    for item in basis['referenceBindings'] + basis['retainedCopyInputs'] + basis['signedAppFileManifest']:
        path = Path(item['path'])
        core.require(core.digest(path, guard) == item['sha256'] and path.stat().st_size == item['bytes'],
            'Retained public input/receipt/app changed: ' + str(path))
    copied = {str(source / item['destination']) for item in original['inputs']}
    core.require(copied == {item['path'] for item in basis['retainedCopyInputs']}, 'The original113 retained destinations changed')
    app = Path(basis['retainedSignedApp'])
    actual_app = {str(path) for path in app.rglob('*') if path.is_file() or path.is_symlink()}
    core.require(actual_app == {item['path'] for item in basis['signedAppFileManifest']}, 'Signed Source44 app membership changed')
    expected_control = {item['path'] for item in basis['retainedCopyInputs'] if item['destination'].startswith('control/')}
    actual_control = {str(path) for path in (source / 'control').rglob('*') if path.is_file() or path.is_symlink()}
    core.require(actual_control == expected_control and len(expected_control) == 5, 'The exact retained control project changed')
    owner = json.loads((source / 'owner.json').read_bytes())
    failure = json.loads((source / 'failure.json').read_bytes())
    core.require(owner['executorSHA256'] == PREVIOUS_EXECUTOR_SHA256 and owner['inputsSHA256'] == core.INPUTS_SHA256
        and owner['outputRoot'] == str(source) and failure['nonce'] == owner['nonce']
        and failure['status'] == 'failed-build-preserved-no-retry' and len(failure['commands']) == 5,
        'Wrong preceding owner/actual failure receipt')
    labels = ['compile-source-swift-shell', 'sign-copied-framework-ad-hoc', 'sign-isolated-source-app-ad-hoc',
        'verify-isolated-source-app', 'build-native-scroll-control-only']
    core.require([item['label'] for item in failure['commands']] == labels
        and all(item['exitCode'] == 0 and item['stopped'] is None for item in failure['commands'][:4])
        and failure['commands'][4]['exitCode'] == -9 and failure['commands'][4]['stopped'] == 'unexpected-large-owned-file',
        'Source shell/sign verification and incomplete control scopes must remain distinct')
    for command in failure['commands']:
        for stream in ('stdout', 'stderr'):
            core.require(core.digest(source / (command['label'] + '.' + stream), guard) == command[stream + 'SHA256'],
                'The preceding native command buffer changed')
    raw = Path(basis['rawFrameworkPath'])
    signed = app / 'Frameworks/SlaxSourceFixture.framework/SlaxSourceFixture'
    core.require(core.macho_sections(raw) == core.macho_sections(signed) == basis['verifiedUnchanged33Sections'],
        'The exact original33 file-backed sections changed')
    info = plistlib.loads((app / 'Info.plist').read_bytes())
    core.require(info['CFBundleIdentifier'] == 'app.slax.reader.sourcefixture'
        and info['CFBundleVersion'] == '1' and info['CFBundleShortVersionString'] == '1.0.0', 'Wrong retained fixture identity')
    return basis


def owned_allocation(path, output, basis):
    core.require(output.parent == Path('/private/tmp') and not output.exists() and not output.is_symlink()
        and re.fullmatch(r'slax-source-native-scroll-control-[0-9a-f-]{36}', output.name), 'Fresh control-only root required')
    uuid.UUID(output.name.removeprefix('slax-source-native-scroll-control-'))
    core.require(path.is_relative_to(ROOT), 'Root allocation must be a historical allocation file')
    grant = json.loads(core.regular(path).read_bytes())
    expected = {'kind': 'slax-root-source-native-scroll-control-build-allocation', 'version': 4,
        'outputRoot': str(output), 'basisSHA256': BASIS_SHA256, 'executorSHA256': core.digest(Path(__file__).resolve()),
        'previousExecutorSHA256': PREVIOUS_EXECUTOR_SHA256, 'sourceRoot': basis['sourceRoot'],
        'sourceFailureSHA256': basis['sourceFailureSHA256'], 'rootScopeReportSHA256': basis['rootScopeReportSHA256'],
        'signedSourceExecutableSHA256': basis['sourceShellExecutableSHA256'], 'rawFrameworkSHA256': basis['rawFrameworkSHA256'],
        'original113InputsSHA256': basis['originalInputsManifestSHA256'], 'fixtureInputSHA256': basis['fixtureInputSHA256'],
        'exclusiveNativeSlot': True, 'allowControlBuildOnly': True, 'allowSourceCopy': False,
        'allowSourceSwiftCompile': False, 'allowSignOrVerifyCommands': False, 'allowOldDerivedDataReuse': False,
        'allowKmpOrGradle': False, 'allowDeviceCommands': False, 'allowMetroCommands': False, 'allowCleanup': False}
    core.require(set(grant) == set(expected) | {'nonce', 'requestedAt', 'expiresAt'}
        and all(type(grant.get(key)) is type(value) and grant.get(key) == value for key, value in expected.items()),
        'Fresh exact control-only Root allocation required')
    uuid.UUID(grant['nonce'])
    now = int(time.time() * 1000)
    core.require(type(grant['requestedAt']) is int and type(grant['expiresAt']) is int
        and grant['requestedAt'] <= now < grant['expiresAt'] <= grant['requestedAt'] + 600000, 'Expired control allocation')
    stats = os.statvfs(output.parent)
    core.require(stats.f_bavail * stats.f_frsize >= basis['budget']['minimumFreeBeforeBytes'], '3-GiB plus0.6-GiB reserve required')
    return grant


def exact_sparse_cache(path, output, status, exceptions):
    return (stat.S_ISREG(status.st_mode) and path.resolve() == path
        and exceptions.get(path.relative_to(output).as_posix()) == status.st_size
        and status.st_blocks * 512 < status.st_size)


def resource_status(output, budget, exceptions, observation=None, allow_vanished_generated=False):
    stats = os.statvfs(output)
    free = stats.f_bavail * stats.f_frsize
    if observation is not None:
        observation['minimumFreeObservedBytes'] = min(observation.get('minimumFreeObservedBytes', free), free)
    if free < budget['minimumFreeDuringBytes']:
        return 'disk-floor'
    allocated, products = output.lstat().st_blocks * 512, 0
    for path in output.rglob('*'):
        try:
            status = path.lstat()
        except FileNotFoundError:
            if allow_vanished_generated and path.relative_to(output).parts[0] == 'derived-data':
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
            if path.relative_to(output).as_posix().startswith('derived-data/Build/Products/'):
                products += status.st_size
            if status.st_size > budget['maximumNewProductLogicalBytes'] and not exact_sparse_cache(path, output, status, exceptions):
                return 'unexpected-large-owned-file'
        if observation is not None:
            observation['maximumAllocatedObservedBytes'] = max(observation.get('maximumAllocatedObservedBytes', 0), allocated)
            observation['maximumProductLogicalObservedBytes'] = max(observation.get('maximumProductLogicalObservedBytes', 0), products)
        if allocated > budget['maximumNewAllocatedBytes'] or products > budget['maximumNewProductLogicalBytes']:
            return 'new-artifact-cap'
    return None


def product_records(output, exceptions, guard):
    records = {}
    for path in output.rglob('*'):
        core.require(guard() is None, 'Final full accounting stopped product records')
        status = path.lstat()
        if stat.S_ISREG(status.st_mode):
            entry = {'bytes': status.st_size, 'allocatedBytes': status.st_blocks * 512, 'mode': stat.S_IMODE(status.st_mode)}
            if exact_sparse_cache(path, output, status, exceptions):
                # These three rebuildable cache files are recorded by actual
                # metadata; never read their 1/8/16-GiB sparse virtual contents.
                entry.update(contentHashed=False, reason='Exact known rebuildable sparse compilation-cache metadata')
            else:
                entry.update(contentHashed=True, sha256=core.digest(path, guard))
            records[path.relative_to(output).as_posix()] = entry
    return records


def thin_arm64(path):
    with core.regular(path).open('rb') as handle:
        header = handle.read(32)
    core.require(len(header) == 32 and header[:4] == b'\xcf\xfa\xed\xfe'
        and struct.unpack_from('<I', header, 4)[0] == 0x0100000c, 'Actual thin arm64 control MachO required')
    return core.digest(path)


def execute(output, allocation):
    basis = checked_basis()
    grant = owned_allocation(allocation, output, basis)
    output.mkdir()
    (output / 'temporary').mkdir()
    (output / 'owner.json').write_text(json.dumps(grant, indent=2) + '\n')
    began = time.monotonic()
    budget, observation = basis['budget'], {}
    report = {'kind': 'slax-source-native-scroll-control-only-build-result', 'version': 4,
        'status': 'started-control-only-build', 'nonce': grant['nonce'], 'basisSHA256': BASIS_SHA256,
        'retainedSignedSourceApp': basis['retainedSignedApp'], 'previousSourceFailureSHA256': basis['sourceFailureSHA256'],
        'commands': [], 'resourceObservation': observation, 'deviceCommands': False, 'sourceRebuilt': False,
        'sourceResigned': False, 'sourceRecopied': False, 'native240Accepted': False}

    def guard(allow_vanished_generated=False):
        if time.monotonic() - began >= budget['maximumTotalSeconds'] or int(time.time() * 1000) >= grant['expiresAt']:
            return 'total-window-expired'
        return resource_status(output, budget, basis['sparseExceptions'], observation, allow_vanished_generated)

    try:
        checked_basis(guard)
        core.require(guard() is None, 'Control resource/window guard rejected invocation')
        derived = output / 'derived-data'
        source = Path(basis['sourceRoot'])
        tools = {item['id']: item['invocationPath'] for item in basis['tools']}
        args = [tools['xcodebuild'], 'build-for-testing', '-project', str(source / 'control/SourceFixtureControl.xcodeproj'),
            '-scheme', 'SourceFixtureControl', '-configuration', 'Debug', '-sdk', 'iphonesimulator',
            '-destination', 'generic/platform=iOS Simulator', '-derivedDataPath', str(derived), '-jobs', '1',
            'ARCHS=arm64', 'ONLY_ACTIVE_ARCH=YES', 'CODE_SIGNING_ALLOWED=NO', 'COMPILER_INDEX_STORE_ENABLE=NO',
            'CLANG_ENABLE_COMPILE_CACHE=NO', 'SWIFT_ENABLE_COMPILE_CACHE=NO', 'COMPILATION_CACHE_ENABLE_CACHING=NO',
            'CLANG_MODULE_CACHE_PATH=' + str(derived / 'ModuleCache.noindex'),
            'MODULE_CACHE_DIR=' + str(derived / 'ModuleCache.noindex'),
            'SDK_STAT_CACHE_DIR=' + str(derived / 'SDKStatCaches.noindex')]
        environment = {'PATH': '/usr/bin:/bin', 'LANG': 'C', 'DEVELOPER_DIR': basis['developerDirectory'],
            'TMPDIR': str(output / 'temporary')}
        left = min(budget['xcodebuildSeconds'], budget['maximumTotalSeconds'] - (time.monotonic() - began),
            (grant['expiresAt'] - int(time.time() * 1000)) / 1000)
        core.require(left > 0, 'Control build window expired')
        code, stdout, stderr, stopped = core.bounded_command(args, environment, output, left,
            budget['maximumOutputBytesPerCommand'], lambda: guard(allow_vanished_generated=True))
        (output / 'build-native-scroll-control-only.stdout').write_bytes(stdout)
        (output / 'build-native-scroll-control-only.stderr').write_bytes(stderr)
        report['commands'].append({'argv': args, 'exitCode': code, 'stopped': stopped,
            'stdoutSHA256': hashlib.sha256(stdout).hexdigest(), 'stderrSHA256': hashlib.sha256(stderr).hexdigest()})
        core.require(code == 0 and stopped is None and b'** TEST BUILD SUCCEEDED **' in stdout,
            'Control build failed/stopped or omitted its actual success marker; preserve without retry')
        core.require(guard() is None, 'Strict stopped-process accounting rejected control products')
        checked_basis(guard)
        test_runs = [path for path in derived.rglob('*.xctestrun') if path.is_file() and not path.is_symlink()]
        core.require(len(test_runs) == 1, 'Exactly one actual built control xctestrun required')
        products = derived / 'Build/Products/Debug-iphonesimulator'
        host = products / 'ControlHost.app'
        runner = products / 'SourceFixtureControl-Runner.app'
        test = runner / 'PlugIns/SourceFixtureControl.xctest'
        host_info = plistlib.loads((host / 'Info.plist').read_bytes())
        runner_info = plistlib.loads((runner / 'Info.plist').read_bytes())
        test_info = plistlib.loads((test / 'Info.plist').read_bytes())
        core.require(host_info['CFBundleIdentifier'] == 'app.slax.reader.sourcefixture.controlhost'
            and test_info['CFBundleIdentifier'] == 'app.slax.reader.sourcefixture.control'
            and runner_info['CFBundleIdentifier'] == 'app.slax.reader.sourcefixture.control.xctrunner',
            'Wrong actual helper identities')
        test_run = plistlib.loads(test_runs[0].read_bytes())
        format_version = test_run.get('__xctestrun_metadata__', {}).get('FormatVersion')
        core.require(type(format_version) is int and format_version > 0, 'Actual xctestrun format metadata required')
        report.update(status='control-built-source-shell-success-retained-no-device-execution',
            testRunPath=str(test_runs[0]), testRunSHA256=core.digest(test_runs[0], guard),
            testRunFormatVersion=format_version, testRunTopLevelKeys=sorted(test_run),
            hostExecutableSHA256=thin_arm64(host / host_info['CFBundleExecutable']),
            runnerExecutableSHA256=thin_arm64(runner / runner_info['CFBundleExecutable']),
            testExecutableSHA256=thin_arm64(test / test_info['CFBundleExecutable']),
            sourceShellExecutableSHA256=basis['sourceShellExecutableSHA256'],
            original33SectionsUnchanged=True, controlSigning='Unsigned; separate device allocation and artifact binding required')
        report['regularProducts'] = product_records(output, basis['sparseExceptions'], guard)
        report['elapsedSeconds'] = time.monotonic() - began
        serialized = (json.dumps(report, indent=2) + '\n').encode()
        core.require(len(serialized) <= 1024 * 1024 and guard() is None, 'Final control record exceeded resource/window budget')
        (output / 'report.json').write_bytes(serialized)
        core.require(guard() is None, 'Final recorded control result rejected')
    except BaseException as error:
        report.update(status='failed-control-only-build-preserved-no-retry', elapsedSeconds=time.monotonic() - began,
            error=type(error).__name__ + ': ' + str(error))
        if (output / 'report.json').exists():
            (output / 'report.json').rename(output / 'rejected-completed-record.json')
        try:
            (output / 'failure.json').write_text(json.dumps(report, indent=2) + '\n')
        except OSError:
            print(json.dumps(report))
        raise
    print(json.dumps({'status': report['status'], 'report': str(output / 'report.json'), 'deviceCommands': False}))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--execute', action='store_true')
    parser.add_argument('--output-root')
    parser.add_argument('--allocation-file')
    arguments = parser.parse_args()
    if arguments.execute:
        core.require(arguments.output_root and arguments.allocation_file, 'New explicit control-only allocation required')
        execute(Path(arguments.output_root).absolute(), Path(arguments.allocation_file).absolute())
    else:
        basis = checked_basis()
        print(json.dumps({'status': 'prepared-control-only-closed-basis-no-command-execution',
            'basisSHA256': BASIS_SHA256, 'sourceShellAlreadySigned': basis['retainedSignedApp'], 'compilerOrDeviceExecuted': False}))


if __name__ == '__main__':
    main()
