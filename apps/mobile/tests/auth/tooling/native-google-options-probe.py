#!/usr/bin/env python3
"""Check cached public inputs, or execute one explicitly allocated account-free SDK probe."""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import re
import selectors
import signal
import struct
import subprocess
import tempfile
import time
import zipfile

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[4]
CACHE_SHA256 = 'c50f7ac6ae0e3c23bdc55b83b2ebd1cf029c08b631bead2daec0871a7244d9b4'
SOURCE_NAMES = {
    'apps/mobile/modules/slax-platform/android/src/main/java/com/slax/reader/platform/SlaxGoogleSignIn.kt',
    'apps/mobile/tests/auth/NativeGoogleOptionsProbe.java',
    'apps/mobile/modules/slax-platform/android/build.gradle',
    'apps/mobile/tests/auth/README.md',
}
ARTIFACT_IDS = {'googleid', 'credentials', 'androidx-core', 'biometric', 'androidx-annotation', 'jspecify', 'stdlib',
    'coroutines-core', 'coroutines-android', 'annotations', 'compiler', 'build-tools-api', 'script-runtime', 'reflect',
    'daemon', 'compiler-coroutines', 'android-api', 'd8', 'adb', 'java', 'javac', 'jdk-release', 'jdk-java-base'}
CLASS_NAME = r'(?:[A-Za-z0-9_$]+/)*(?:[A-Za-z0-9_$]+|package-info)'


def require(value, message):
    if not value:
        raise ValueError(message)


def regular(location):
    path = Path(location)
    require(path.is_file() and not path.is_symlink() and path.resolve() == path, 'A canonical regular public input is required')
    return path


def sha(data):
    return hashlib.sha256(data).hexdigest()


def file_sha(location):
    digest = hashlib.sha256()
    with regular(location).open('rb') as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def class_entries(data):
    entries = {}
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        for entry in archive.infolist():
            if entry.filename.startswith('META-INF/') or not entry.filename.endswith('.class'):
                continue
            require(re.fullmatch(CLASS_NAME + r'\.class', entry.filename) and entry.file_size <= 2 * 1024 * 1024,
                'Only bounded class entries are accepted')
            name = entry.filename[:-6]
            require(name not in entries, 'Duplicate cached class entry')
            entries[name] = archive.read(entry)
    return entries


def runtime_references(data):
    """Read real JVM class/descriptors; Kotlin metadata type aliases are not VM classes."""
    require(data[:4] == b'\xca\xfe\xba\xbe', 'Expected an actual JVM class')
    count = struct.unpack_from('>H', data, 8)[0]
    offset, index, utf, classes, descriptors = 10, 1, {}, [], []
    while index < count:
        tag = data[offset]
        offset += 1
        if tag == 1:
            size = struct.unpack_from('>H', data, offset)[0]
            offset += 2
            utf[index] = data[offset:offset + size].decode('utf8', errors='replace')
            offset += size
        elif tag == 7:
            classes.append(struct.unpack_from('>H', data, offset)[0]); offset += 2
        elif tag == 12:
            descriptors.append(struct.unpack_from('>H', data, offset + 2)[0]); offset += 4
        elif tag in (3, 4, 9, 10, 11, 17, 18):
            offset += 4
        elif tag in (5, 6):
            offset += 8; index += 1
        elif tag in (8, 16, 19, 20):
            offset += 2
        elif tag == 15:
            offset += 3
        else:
            raise ValueError('Unknown public class constant')
        index += 1
    result = set()
    descriptor_classes = lambda value: re.findall(r'L([A-Za-z0-9_/$]+);', value)
    for item in classes:
        value = utf[item]
        result.update(descriptor_classes(value)) if value.startswith('[') else result.add(value)
    for item in descriptors:
        result.update(descriptor_classes(utf[item]))
    offset += 6
    interfaces = struct.unpack_from('>H', data, offset)[0]
    offset += 2 + 2 * interfaces
    for _section in range(2):
        members = struct.unpack_from('>H', data, offset)[0]; offset += 2
        for _member in range(members):
            _access, _name, descriptor, attributes = struct.unpack_from('>HHHH', data, offset); offset += 8
            result.update(descriptor_classes(utf[descriptor]))
            for _attribute in range(attributes):
                size = struct.unpack_from('>I', data, offset + 2)[0]; offset += 6 + size
    return result


def load_closure():
    contents = regular(HERE / 'native-google-options-cache.json').read_bytes()
    require(sha(contents) == CACHE_SHA256, 'Cached closure manifest changed')
    manifest = json.loads(contents)
    require(manifest['kind'] == 'slax-google-options-cached-public-closure' and manifest['version'] == 1
        and set(manifest['sources']) == SOURCE_NAMES and {value['id'] for value in manifest['artifacts']} == ARTIFACT_IDS
        and len(manifest['artifacts']) == len(ARTIFACT_IDS), 'Cached closure must be the exact reviewed set')
    for name, digest in manifest['sources'].items():
        require(file_sha(ROOT / name) == digest, 'Whole production helper/probe/dependency declaration changed')
    artifacts, classes, owners, jars = {}, {}, {}, {}
    for value in manifest['artifacts']:
        path = regular(value['path'])
        require(path.stat().st_size == value['bytes'] and file_sha(path) == value['sha256'], 'Public SDK/tool cache is missing or changed')
        artifacts[value['id']] = value
        if value['role'] in ('sdk', 'sdk-compiler'):
            data = path.read_bytes()
            if path.suffix == '.aar':
                with zipfile.ZipFile(io.BytesIO(data)) as archive:
                    data = archive.read('classes.jar')
                require(len(data) == value['classesJarBytes'] and sha(data) == value['classesJarSHA256'], 'Actual SDK classes.jar changed')
            jars[value['id']] = data
            for name, bytecode in class_entries(data).items():
                require(name not in classes or classes[name] == bytecode, 'Incompatible duplicate SDK class')
                classes[name], owners[name] = bytecode, value['id']
    with zipfile.ZipFile(artifacts['android-api']['path']) as platform:
        provided = {name[:-6] for name in platform.namelist() if name.endswith('.class')}
    with zipfile.ZipFile(artifacts['jdk-java-base']['path']) as platform:
        bootstrap = platform.read('classes/' + manifest['knownBootstrapIntrinsic'] + '.class')
    require(bootstrap[:4] == b'\xca\xfe\xba\xbe', 'Real JDK bootstrap class is required for D8 input calibration')
    pending, selected, missing = list(manifest['rootRuntimeClasses']), set(), set()
    while pending:
        name = pending.pop()
        if name in selected or name in provided or name == manifest['knownBootstrapIntrinsic']:
            continue
        if name not in classes:
            missing.add(name); continue
        selected.add(name)
        pending.extend(runtime_references(classes[name]) - selected)
    require(not missing, 'The actual cached request-builder class closure is incomplete')
    owner = manifest['deviceOwner']
    require(file_sha(owner['path']) == owner['sha256'] and file_sha(owner['avdConfigPath']) == owner['avdConfigSHA256'], 'The preserved AVD owner/config changed')
    marker = json.loads(regular(owner['path']).read_text())
    require(marker['kind'] == owner['kind'] and marker['androidName'] == owner['name'] and marker['androidPort'] == owner['port']
        and Path(marker['androidAvdHome']).resolve() == Path(owner['avdHome']), 'A different device owns the allocation')
    return manifest, artifacts, classes, owners, jars, selected, sha(bootstrap)


def load_allocation(location, manifest):
    path = Path(location)
    parent = path.parent
    require(path.name == 'allocation.json' and parent.resolve() == parent and parent.parent == Path(tempfile.gettempdir()).resolve()
        and re.fullmatch(r'slax-google-options-probe-[A-Za-z0-9_]{6,16}', parent.name), 'Allocation must be a fresh canonical immediate temporary child')
    allocation = json.loads(regular(path).read_text())
    now = int(time.time() * 1000)
    require(allocation['kind'] == 'slax-root-controlled-google-options-allocation' and allocation['version'] == 1
        and re.fullmatch(r'[a-zA-Z0-9-]{1,64}', allocation['runId'])
        and re.fullmatch(r'[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}', allocation['nonce'])
        and type(allocation['requestedAt']) is int and type(allocation['expiresAt']) is int
        and allocation['requestedAt'] <= now < allocation['expiresAt'] <= allocation['requestedAt'] + 600000
        and allocation['executorSHA256'] == file_sha(Path(__file__).resolve()) and allocation['closureSHA256'] == CACHE_SHA256
        and allocation['deviceOwnerSHA256'] == manifest['deviceOwner']['sha256'] and allocation['device'] == manifest['deviceOwner']['serial']
        and allocation['exclusiveNativeSlot'] is True and allocation['exclusiveDeviceLoan'] is True
        and allocation['compileAndProbeOnly'] is True and allocation['accountInteractionAllowed'] is False, 'A fresh explicit Root allocation is required')
    require(set(allocation) == {'kind', 'version', 'runId', 'nonce', 'requestedAt', 'expiresAt', 'executorSHA256', 'closureSHA256',
        'deviceOwnerSHA256', 'device', 'exclusiveNativeSlot', 'exclusiveDeviceLoan', 'compileAndProbeOnly', 'accountInteractionAllowed'}, 'Unknown allocation fields')
    require(set(value.name for value in parent.iterdir()) == {'allocation.json'}, 'Preserve an existing execution instead of replacing it')
    require(os.statvfs(parent).f_bavail * os.statvfs(parent).f_frsize >= manifest['budget']['minimumFreeBeforeExecution'], 'Insufficient reserved probe space')
    return parent, allocation


def write_jar(location, classes):
    with zipfile.ZipFile(location, 'x', compression=zipfile.ZIP_STORED) as archive:
        for name in sorted(classes):
            require(re.fullmatch(CLASS_NAME, name), 'Unsafe class output path')
            archive.writestr(name + '.class', classes[name])


def execution_resources(directory, budget):
    status = os.statvfs(directory)
    if status.f_bavail * status.f_frsize < budget['minimumFreeDuringExecution']:
        return 'disk-floor'
    total = 0
    for location in directory.rglob('*'):
        if location.is_symlink():
            return 'unsafe-owned-output'
        if location.is_file():
            total += location.stat().st_size
            if total > budget['hostDisk']:
                return 'host-output-limit'
    return None


def invoke_bounded(args, environment, timeout, maximum_bytes, resources):
    """Capture at most the public-output allowance and kill only this process group."""
    initial = resources()
    if initial:
        return -1, b'', b'', initial
    stdout, stderr, reason = bytearray(), bytearray(), None
    process = subprocess.Popen(args, env=environment, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
        stderr=subprocess.PIPE, start_new_session=True)
    deadline = time.monotonic() + timeout
    try:
        with selectors.DefaultSelector() as selector:
            selector.register(process.stdout, selectors.EVENT_READ, stdout)
            selector.register(process.stderr, selectors.EVENT_READ, stderr)
            while selector.get_map():
                reason = resources()
                if reason:
                    break
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    reason = 'timeout'; break
                for key, _mask in selector.select(min(remaining, 0.1)):
                    chunk = os.read(key.fileobj.fileno(), 8192)
                    if not chunk:
                        selector.unregister(key.fileobj); continue
                    available = maximum_bytes - len(stdout) - len(stderr)
                    key.data.extend(chunk[:available])
                    if len(chunk) > available:
                        reason = 'output-limit'; break
                if reason:
                    break
        if reason or process.poll() is None:
            if reason is None:
                while process.poll() is None and reason is None:
                    reason = resources()
                    remaining = deadline - time.monotonic()
                    if remaining <= 0:
                        reason = 'timeout'
                    elif reason is None:
                        time.sleep(min(0.05, remaining))
            if reason:
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
        process.wait(timeout=1)
        if reason is None:
            reason = resources()
    finally:
        if process.poll() is None:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            process.wait(timeout=1)
        process.stdout.close(); process.stderr.close()
    return process.returncode, bytes(stdout), bytes(stderr), reason


def execute(location):
    manifest, artifacts, classes, owners, jars, selected, _bootstrap = load_closure()
    output, allocation = load_allocation(location, manifest)
    deadline = time.monotonic() + manifest['budget']['executionMilliseconds'] / 1000
    with (output / 'execution-started.json').open('x') as handle:
        handle.write(json.dumps({'nonce': allocation['nonce'], 'requestedAt': allocation['requestedAt']}))
    environment = {'PATH': '/usr/bin:/bin', 'LANG': 'C', 'JAVA_HOME': manifest['jdkHome'], 'TMPDIR': str(output)}
    commands = []

    def run(args, label):
        require(time.monotonic() < deadline and int(time.time() * 1000) < allocation['expiresAt'], 'Execution allocation expired')
        load_closure()
        timeout = min(manifest['budget']['commandMilliseconds'] / 1000, deadline - time.monotonic())
        require(timeout > 0, 'Execution allocation expired during public-input verification')
        exit_code, stdout, stderr, stopped = invoke_bounded(args, environment, timeout, 256 * 1024,
            lambda: execution_resources(output, manifest['budget']))
        (output / (label + '.stdout')).write_bytes(stdout); (output / (label + '.stderr')).write_bytes(stderr)
        commands.append({'label': label, 'exitCode': exit_code, 'stopped': stopped, 'stdoutSHA256': sha(stdout), 'stderrSHA256': sha(stderr)})
        if stopped or exit_code != 0:
            (output / 'failed-command.json').write_text(json.dumps({'runId': allocation['runId'], 'nonce': allocation['nonce'],
                'status': 'failed', 'commands': commands, 'closureSHA256': CACHE_SHA256}, indent=2) + '\n')
        require(not stopped and exit_code == 0, 'Controlled public SDK command failed; bounded logs require review')
        return stdout.decode('utf8').strip()

    adb = [artifacts['adb']['path'], '-s', allocation['device']]
    require(run(adb + ['get-state'], 'device-state') == 'device', 'The allocated emulator is not available')
    require(run(adb + ['emu', 'avd', 'name'], 'avd-name').splitlines() == [manifest['deviceOwner']['name'], 'OK'], 'The live AVD identity does not match')
    require(run(adb + ['shell', 'getprop', 'sys.boot_completed'], 'boot-state') == '1', 'Root must boot the allocated emulator first')
    require(run(adb + ['shell', 'getprop', 'ro.build.version.sdk'], 'api') == str(manifest['deviceOwner']['requiredApi']), 'Unexpected controlled Android API')
    require(run(adb + ['shell', 'getprop', 'ro.product.cpu.abi'], 'abi') == manifest['deviceOwner']['requiredAbi'], 'Unexpected controlled Android ABI')
    stage = output / 'stage'; stage.mkdir()
    for ident, data in jars.items():
        (stage / (ident + '.jar')).write_bytes(data)
    compile_classpath = os.pathsep.join([str(stage / (ident + '.jar')) for ident in manifest['sdkCompileIds']] + [artifacts['android-api']['path']])
    compiler_classpath = os.pathsep.join(artifacts[ident]['path'] for ident in manifest['compilerIds'])
    kotlin, java = stage / 'kotlin', stage / 'java'; kotlin.mkdir(); java.mkdir()
    java_command = [artifacts['java']['path'], '-Xmx512m', '-XX:ActiveProcessorCount=1']
    helper = ROOT / 'apps/mobile/modules/slax-platform/android/src/main/java/com/slax/reader/platform/SlaxGoogleSignIn.kt'
    probe = ROOT / 'apps/mobile/tests/auth/NativeGoogleOptionsProbe.java'
    run(java_command + ['-cp', compiler_classpath, 'org.jetbrains.kotlin.cli.jvm.K2JVMCompiler', '-no-stdlib', '-no-reflect', '-jvm-target', '1.8',
        '-classpath', compile_classpath, '-d', str(kotlin), str(helper)], 'compile-whole-production-helper')
    run([artifacts['javac']['path'], '-J-Xmx512m', '-J-XX:ActiveProcessorCount=1', '--release', '8', '-d', str(java), str(probe)], 'compile-exact-probe')
    program = {name: classes[name] for name in selected}
    for ident in manifest['wholeRuntimeJarIds']:
        program.update(class_entries(jars[ident]))
    for directory, prefix in [(kotlin, 'com/slax/reader/platform/SlaxGoogleSignIn'), (java, 'com/slax/reader/auth/fixture/NativeGoogleOptionsProbe')]:
        compiled = list(directory.rglob('*.class')); require(0 < len(compiled) <= 16, 'Unexpected compiled helper/probe class count')
        for path in compiled:
            regular(path); name = path.relative_to(directory).as_posix()[:-6]
            require(name == prefix or name.startswith(prefix + '$'), 'Unreviewed source entered the probe')
            program[name] = path.read_bytes()
    write_jar(stage / 'program.jar', program)
    compile_only = {name: data for name, data in classes.items() if name not in program}
    write_jar(stage / 'compile-only-sdk.jar', compile_only)
    dex = stage / 'dex'; dex.mkdir()
    run(java_command + ['-cp', artifacts['d8']['path'], 'com.android.tools.r8.D8', '--min-api', '26', '--lib', artifacts['android-api']['path'],
        '--classpath', str(stage / 'compile-only-sdk.jar'), '--output', str(dex), str(stage / 'program.jar')], 'dex-actual-program')
    require(not re.search(r'missing class|not found|unresolved', (output / 'dex-actual-program.stderr').read_text(), re.I), 'Unresolved actual D8 dependencies require review')
    dex_files = sorted(dex.glob('classes*.dex')); require(len(dex_files) == 1, 'Only the bounded single-Dex probe is accepted')
    probe_jar = stage / 'probe.jar'
    with zipfile.ZipFile(probe_jar, 'x', compression=zipfile.ZIP_STORED) as archive:
        archive.write(dex_files[0], 'classes.dex')
    require(probe_jar.stat().st_size <= manifest['budget']['deviceDisk'], 'The device probe exceeds its bound')
    require(sum(path.stat().st_size for path in output.rglob('*') if path.is_file()) <= manifest['budget']['hostDisk'], 'The host probe exceeds its bound')
    load_closure()
    require(run(adb + ['emu', 'avd', 'name'], 'recheck-avd-name').splitlines() == [manifest['deviceOwner']['name'], 'OK'], 'The allocated AVD changed during compilation')
    require(run(adb + ['shell', 'getprop', 'sys.boot_completed'], 'recheck-boot-state') == '1', 'The allocated emulator is no longer booted')
    destination = '/data/local/tmp/slax-google-options-probe-' + allocation['nonce'] + '.jar'
    run(adb + ['push', str(probe_jar), destination], 'push-nonce-probe')
    require(run(adb + ['shell', 'sha256sum', destination], 'verify-device-probe').split()[0] == file_sha(probe_jar), 'Device probe hash differs')
    run(adb + ['shell', 'chmod', '0444', destination], 'readonly-device-dex')
    result = json.loads(run(adb + ['shell', 'env', 'CLASSPATH=' + destination, '/system/bin/app_process', '/system/bin',
        'com.slax.reader.auth.fixture.NativeGoogleOptionsProbe'], 'actual-request-builder'))
    require(result == {'kind': 'slax-controlled-native-google-options', 'filterByAuthorizedAccounts': False, 'autoSelectEnabled': True,
        'credentialOptions': 1, 'missingClientIdsRejected': 2, 'credentialRequestExecuted': False, 'accountInteraction': False}, 'Unexpected SDK probe result')
    report = {'kind': 'slax-native-google-options-result', 'version': 1, 'status': 'passed', 'runId': allocation['runId'], 'nonce': allocation['nonce'],
        'device': allocation['device'], 'closureSHA256': CACHE_SHA256, 'executorSHA256': file_sha(Path(__file__).resolve()), 'commands': commands,
        'result': result, 'probeJarSHA256': file_sha(probe_jar), 'deviceProbePath': destination, 'deviceProbeCleanup': 'pending explicit Root authorization',
        'compiledClassesSHA256': {name: sha(data) for name, data in program.items() if name.startswith('com/slax/reader/')},
        'scope': {'wholeProductionHelperCompiled': True, 'requestConstructedOnRealAndroidSdk': True, 'signInCalled': False, 'accountInteraction': False,
            'mainAppInstalledOrLaunched': False, 'providerBackendLoginVerified': False, 'nativeAppAdapterBuildVerified': False}}
    (output / 'result.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'status': 'passed', 'report': str(output / 'result.json'), 'probeJarSHA256': report['probeJarSHA256']}))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--execute', action='store_true')
    parser.add_argument('--allocation')
    options = parser.parse_args()
    if options.execute:
        require(options.allocation, 'Explicit Root allocation is required before any invocation')
        execute(options.allocation)
    else:
        manifest, _artifacts, _classes, owners, _jars, selected, bootstrap = load_closure()
        if options.allocation:
            load_allocation(options.allocation, manifest)
        print(json.dumps({'status': 'prepared-cached-inputs-verified', 'closureSHA256': CACHE_SHA256, 'executorSHA256': file_sha(Path(__file__).resolve()),
            'rootRuntimeClassCount': len(selected), 'rootRuntimeClassListSHA256': sha('\n'.join(sorted(selected)).encode()),
            'rootRuntimeClassesByArtifact': {ident: sum(owners[name] == ident for name in selected) for ident in sorted(set(owners.values()))},
            'realJdkBootstrapClassSHA256': bootstrap, 'compilerExecuted': False, 'deviceCommand': False, 'accountInteraction': False}))


if __name__ == '__main__':
    main()
