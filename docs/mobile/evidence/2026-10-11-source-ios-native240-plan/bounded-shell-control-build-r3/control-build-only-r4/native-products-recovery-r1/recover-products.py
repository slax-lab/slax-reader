#!/usr/bin/env python3
"""Read-only recovery of already completed Source c234 native products.

No compiler, signing, process, device, source or DerivedData mutation. Only this
fresh durable evidence directory receives copies of named public inputs/logs.
"""
import datetime
import hashlib
import json
from pathlib import Path
import plistlib
import stat
import struct

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[6]
RUN = Path('/private/tmp/slax-source-native-scroll-control-c2347154-a3a2-4ad8-bff0-d3e9cd84dd47')
SOURCE = Path('/private/tmp/slax-source-native-scroll-build-44e898c8-341b-4b07-b7d1-05be69d2b8b1')
PRODUCTS = RUN / 'derived-data/Build/Products'
BASIS = HERE.parent / 'input-basis.json'
BASIS_SHA = 'a1b2e7ecd628f2ee25c3f3dfbe1a21bdaa08341401cbc8bbb0a35f1d82ccec49'
EXECUTOR = REPO / 'apps/mobile/fixtures/source-ios/control/build-control-only.py'
EXECUTOR_SHA = '75e534d172e94d1a0f11306d0c5ee18ba2cdb71a26a4cfbd048db75ca87ed289'
PREVIOUS = REPO / 'apps/mobile/fixtures/source-ios/control/build-native-scroll.py'
PREVIOUS_SHA = '040e3d55c2faf13efb7d2f3e8039c3b8a9893bdd4567f46e25384b50b8fd0d5b'
SDK_RUNNER = Path('/Applications/Xcode.app/Contents/Developer/Platforms/iPhoneSimulator.platform/Developer/Library/Xcode/Agents/XCTRunner.app/XCTRunner')
RUNNER_SHA = '7e36729d4fbf984e023e98952e7a2b878c735240c41c14f1f8a6b1544b20d233'
SLICE_SHA = 'f65a42300d12f70f7a7918c7e21bd819a0ce055418822ed7c6ab60a50bda9b46'
hashes = {}


def require(value, message):
    if not value:
        raise ValueError(message)


def regular(path):
    require(path.is_absolute(), 'Absolute public path required')
    require(all(not p.is_symlink() for p in (path, *path.parents)), 'Symlink public input refused')
    value = path.lstat()
    require(stat.S_ISREG(value.st_mode), 'Regular public input required')
    return value


def digest(path):
    before = regular(path)
    key = (str(path), before.st_size, before.st_mtime_ns)
    if key not in hashes:
        result = hashlib.sha256()
        with path.open('rb') as value:
            for chunk in iter(lambda: value.read(1024 * 1024), b''):
                result.update(chunk)
        after = regular(path)
        require((before.st_size, before.st_mtime_ns, before.st_ino) ==
                (after.st_size, after.st_mtime_ns, after.st_ino), 'Input changed while hashing')
        hashes[key] = result.hexdigest()
    return hashes[key]


def record(path):
    value = regular(path)
    return {'path': str(path), 'bytes': value.st_size, 'mode': stat.S_IMODE(value.st_mode),
            'allocatedBytes': value.st_blocks * 512, 'mtimeNs': value.st_mtime_ns,
            'sha256': digest(path)}


def bound(entry):
    path = Path(entry['path'])
    value = record(path)
    require(value['sha256'] == entry['sha256'] and value['bytes'] == entry['bytes'],
            'Bound public input changed: ' + str(path))
    return value


def archive(path, relative):
    entry = record(path)
    destination = HERE / relative
    require(not destination.exists(), 'Never overwrite recovery evidence')
    destination.parent.mkdir(parents=True, exist_ok=True)
    with destination.open('xb') as output:
        output.write(path.read_bytes())
    require(digest(destination) == entry['sha256'], 'Public archive bytes differ')
    return {**entry, 'archive': str(destination.relative_to(REPO))}


def tree(root):
    require(root.is_dir() and all(not p.is_symlink() for p in (root, *root.parents)), 'Owned tree required')
    entries = []
    for path in [root, *sorted(root.rglob('*'))]:
        value = path.lstat()
        entry = {'relativePath': '.' if path == root else path.relative_to(root).as_posix(),
                 'mode': stat.S_IMODE(value.st_mode), 'mtimeNs': value.st_mtime_ns,
                 'allocatedBytes': value.st_blocks * 512}
        if stat.S_ISDIR(value.st_mode):
            entry['kind'] = 'directory'
        else:
            require(stat.S_ISREG(value.st_mode) and not path.is_symlink(), 'Nonregular product refused')
            entry.update({'kind': 'regular', 'bytes': value.st_size, 'sha256': digest(path)})
        entries.append(entry)
    return {'root': str(root), 'entries': entries,
            'regularFiles': sum(e['kind'] == 'regular' for e in entries),
            'directories': sum(e['kind'] == 'directory' for e in entries),
            'logicalBytes': sum(e.get('bytes', 0) for e in entries),
            'allocatedBytes': sum(e['allocatedBytes'] for e in entries), 'symlinks': []}


def thin(path):
    entry = record(path)
    with path.open('rb') as value:
        header = value.read(12)
    require(len(header) == 12 and struct.unpack('<III', header) ==
            (0xfeedfacf, 0x0100000c, 0), 'Actual thin arm64 host/test required')
    return {**entry, 'container': 'thin64', 'magic': '0xfeedfacf', 'cpuType': 0x0100000c, 'cpuSubtype': 0}


def runner(path):
    entry = record(path)
    require(entry['sha256'] == RUNNER_SHA, 'Only the observed Apple copied runner permitted')
    data = path.read_bytes()
    require(struct.unpack('>II', data[:8]) == (0xcafebabe, 1), 'Exactly one FAT32 slice required')
    cpu, sub, offset, length, align = struct.unpack('>IIIII', data[8:28])
    require((cpu, sub, offset, length, align) == (0x0100000c, 0, 0x4000, 0x17bd0, 14),
            'Observed exact runner slice metadata required')
    require(offset + length == len(data) and offset % (1 << align) == 0, 'Runner slice extent/alignment mismatch')
    value = data[offset:offset + length]
    require(struct.unpack('<III', value[:12]) == (0xfeedfacf, 0x0100000c, 0) and
            hashlib.sha256(value).hexdigest() == SLICE_SHA, 'Exact underlying thin arm64 slice required')
    sdk = SDK_RUNNER.read_bytes()
    require(struct.unpack('>II', sdk[:8]) == (0xcafebabe, 2), 'Bound public SDK runner FAT32 required')
    candidates = []
    for index in range(2):
        c, s, o, n, a = struct.unpack('>IIIII', sdk[8 + index * 20:28 + index * 20])
        require(o + n <= len(sdk) and o % (1 << a) == 0, 'SDK runner slice invalid')
        if c == 0x0100000c and s == 0:
            candidates.append((o, n, a))
    require(candidates == [(81920, 97232, 14)] and sdk[81920:81920 + 97232] == value,
            'Copied runner differs from actual installed Xcode arm64 slice')
    return {**entry, 'container': 'FAT32', 'magic': '0xcafebabe', 'numberOfSlices': 1,
            'cpuType': cpu, 'cpuSubtype': sub, 'sliceOffset': offset, 'sliceBytes': length,
            'alignmentPower': align, 'sliceEndsAtEOF': True, 'innerMagic': '0xfeedfacf',
            'sliceSHA256': SLICE_SHA, 'sdkSource': record(SDK_RUNNER),
            'sdkArm64SliceOffset': 81920, 'sdkArm64SliceBytes': 97232,
            'sdkArm64SliceByteIdentical': True, 'generalArchitectureWaiver': False}


def write(name, value):
    path = HERE / name
    require(not path.exists(), 'Never overwrite immutable recovery artifact')
    with path.open('x') as output:
        output.write(json.dumps(value, indent=2) + '\n')
    return record(path)


def main():
    require(REPO == Path('/Users/daguang/.codex/worktrees/expo-mobile-migration/slax-reader'), 'Exact worktree required')
    require(sorted(p.name for p in HERE.iterdir()) == ['recover-products.py'], 'Fresh evidence folder required')
    require(digest(BASIS) == BASIS_SHA and digest(EXECUTOR) == EXECUTOR_SHA and digest(PREVIOUS) == PREVIOUS_SHA,
            'Frozen basis/executors changed')
    basis = json.loads(BASIS.read_bytes())
    require(basis['sourceRoot'] == str(SOURCE), 'Exact retained Source44 required')
    failure_path = RUN / 'failure.json'
    failure = json.loads(failure_path.read_bytes())
    owner = json.loads((RUN / 'owner.json').read_bytes())
    require(failure['status'] == 'failed-control-only-build-preserved-no-retry' and
            failure['error'] == 'ValueError: Actual thin arm64 control MachO required', 'Keep exact post-build assertion failure')
    require(failure['basisSHA256'] == owner['basisSHA256'] == BASIS_SHA and
            owner['executorSHA256'] == EXECUTOR_SHA and owner['outputRoot'] == str(RUN), 'Exact current allocation/receipt required')
    require(len(failure['commands']) == 1 and failure['commands'][0]['exitCode'] == 0 and
            failure['commands'][0]['stopped'] is None, 'Actual single native command must have completed')
    stdout, stderr = RUN / 'build-native-scroll-control-only.stdout', RUN / 'build-native-scroll-control-only.stderr'
    command = failure['commands'][0]
    require(digest(stdout) == command['stdoutSHA256'] and digest(stderr) == command['stderrSHA256'], 'Raw native buffers changed')
    log = stdout.read_text()
    require(log.rstrip().endswith('** TEST BUILD SUCCEEDED **'), 'Actual terminal TEST BUILD SUCCEEDED required')
    lines = [{'line': i + 1, 'text': line} for i, line in enumerate(log.splitlines())
             if ' -extract arm64' in line or '** TEST BUILD SUCCEEDED **' in line or line.startswith('SwiftCompile normal arm64 /tmp/')]
    products = tree(PRODUCTS)
    reference = [bound(e) for e in basis['referenceBindings']]
    retained = [bound(e) for e in basis['retainedCopyInputs']]
    signed = [bound(e) for e in basis['signedAppFileManifest']]
    require(len(retained) == 113 and len(signed) == 109, 'Exact retained source/app basis required')
    controls = []
    for item in basis['retainedCopyInputs']:
        if item['destination'].startswith('control/'):
            current = record(Path(item['originalPath']))
            require(current['bytes'] == item['bytes'] and current['sha256'] == item['originalSHA256'] == item['sha256'],
                    'Current and retained five control inputs changed')
            controls.append({'current': current, 'compiledInput': bound(item),
                             'archive': archive(Path(item['originalPath']), 'source-inputs/' + item['destination'][8:])})
    require(len(controls) == 5, 'Exactly five actual control inputs required')
    native = [thin(PRODUCTS / 'Debug-iphonesimulator/ControlHost.app/ControlHost'),
              thin(PRODUCTS / 'Debug-iphonesimulator/SourceFixtureControl-Runner.app/PlugIns/SourceFixtureControl.xctest/SourceFixtureControl'),
              runner(PRODUCTS / 'Debug-iphonesimulator/SourceFixtureControl-Runner.app/SourceFixtureControl-Runner')]
    xcts = list(PRODUCTS.glob('*.xctestrun'))
    require(len(xcts) == 1, 'Unique actual xctestrun required')
    xct = plistlib.loads(xcts[0].read_bytes())
    require(set(xct) == {'SourceFixtureControl', '__xctestrun_metadata__'} and
            xct['__xctestrun_metadata__']['FormatVersion'] == 1, 'Actual v1 Source control xctestrun required')
    target = xct['SourceFixtureControl']
    require(target['TestHostBundleIdentifier'] == 'app.slax.reader.sourcefixture.control.xctrunner' and
            target['UITargetAppPath'] == '__TESTROOT__/Debug-iphonesimulator/ControlHost.app' and
            target['TestBundlePath'] == '__TESTHOST__/PlugIns/SourceFixtureControl.xctest', 'Unique empty host/test linkage required')
    identities = []
    for rel, identity in [('Debug-iphonesimulator/ControlHost.app/Info.plist', 'app.slax.reader.sourcefixture.controlhost'),
                          ('Debug-iphonesimulator/SourceFixtureControl-Runner.app/Info.plist', 'app.slax.reader.sourcefixture.control.xctrunner'),
                          ('Debug-iphonesimulator/SourceFixtureControl-Runner.app/PlugIns/SourceFixtureControl.xctest/Info.plist', 'app.slax.reader.sourcefixture.control')]:
        path = PRODUCTS / rel
        info = plistlib.loads(path.read_bytes())
        require(info['CFBundleIdentifier'] == identity and info['CFBundleSupportedPlatforms'] == ['iPhoneSimulator'], 'Isolated simulator identity required')
        identities.append({'identity': identity, 'actualInfo': record(path), 'platform': info['DTPlatformName']})
    original = archive(BASIS, 'raw/input-basis.json')
    raw = [archive(p, 'raw/' + p.name) for p in (failure_path, RUN / 'owner.json', stdout, stderr, xcts[0])]
    closure = write('retained-basis-verification.json', {'kind': 'source-control-recovery-retained-basis', 'referenceBindings': reference,
                    'retained113Inputs': retained, 'signed109AppFiles': signed, 'currentAndCompiledFiveControlInputs': controls,
                    'rawFramework': record(Path(basis['rawFrameworkPath'])), 'archivedBasis': original,
                    'frozenCurrentExecutor': record(EXECUTOR), 'frozenPreviousExecutor': record(PREVIOUS)})
    product_record = write('compiled-products.json', products)
    require(tree(PRODUCTS) == products, 'Product bytes/metadata changed while archiving')
    require(digest(failure_path) == raw[0]['sha256'], 'Original failed receipt must remain unchanged')
    report = {'kind': 'source-native-scroll-control-actual-product-recovery', 'version': 1, 'openSpecChange': 'expo-mobile-migration',
              'status': 'actual-control-build-command-pass-products-recovered-original-postassertion-failure-preserved',
              'observedAtUTC': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'actualRoot': str(RUN),
              'preparedOnlyRecoveryNoNativeCommand': True, 'nativeCommandActualExitCode': 0, 'nativeCommandActualStopped': None,
              'actualTerminalMarker': '** TEST BUILD SUCCEEDED **', 'originalExecutorResult': 'failed-post-build-thin-runner-assertion',
              'oldFailurePreserved': raw[0], 'actualRawArtifacts': raw, 'actualBoundedLogProvenance': lines,
              'actualNativeMachOs': native, 'actualIdentities': identities, 'actualXctestrun': {**record(xcts[0]), 'formatVersion': 1,
              'module': 'SourceFixtureControl', 'targetConfiguration': target}, 'compiledProducts': product_record,
              'retainedBasisVerification': closure, 'productFiles': products['regularFiles'], 'productLogicalBytes': products['logicalBytes'],
              'resourceObservationFromActualCommand': failure['resourceObservation'], 'readOnlyRevalidation': {
              'retained113': True, 'signedSource109': True, 'currentFiveControl': True, 'allReferenceBindings': True,
              'productClosedSetAndMetadataBeforeAfter': True, 'oldFailureUnchanged': True},
              'reviewPasses': {'Bugs': 'Recover only this observed exact FAT32 single arm64 Apple runner; host/test remain thin arm64. All actual products, command buffers and input copies are bound. No executor rewrite, retry or broad architecture waiver.',
              'Security': 'Only named public isolated fixture artifacts; no production identity/AppGroup, credentials, compiler, signing, device, process or cleanup invocation.',
              'Compliance': 'OpenSpec expo-mobile-migration. Completed helper compilation is distinct from native execution, source240 callback or visual/gesture acceptance.'},
              'sourceRecopied': False, 'sourceRecompiled': False, 'sourceResigned': False, 'controlRecompiled': False,
              'executorEdited': False, 'deviceCommands': False, 'cleanup': False, 'nativeReaderExecuted': False,
              'native240Accepted': False, 'sourceCallbackObserved': False, 'nativeGestureVerified': False,
              'nativeTestsExecuted': False, 'publisherArtifact': False, 'generalArchitectureWaiver': False}
    final = write('report.json', report)
    print(json.dumps({'report': final, 'products': product_record, 'retainedBasis': closure,
                      'files': products['regularFiles'], 'native240Accepted': False}, indent=2))


if __name__ == '__main__':
    main()
