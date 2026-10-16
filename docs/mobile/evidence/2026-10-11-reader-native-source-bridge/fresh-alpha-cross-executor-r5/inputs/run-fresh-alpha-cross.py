#!/usr/bin/env python3
"""Prepared only. One owner process, two explicit grants, and one live native range."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import plistlib
import re
import signal
import stat
import subprocess
import time
from urllib.parse import urlparse

REPO = Path(__file__).resolve().parents[6]
HERE = Path(__file__).resolve().parent
BASE = HERE.parents[1] / 'fresh-alpha-cross-plan-r1/plan.json'
BASE_SHA = 'f0e459b257a912de98d63ef1dad09e4beadab4249972daf00f2fa1dd32992c98'
POLICY = HERE / 'runtime-policy.json'
RUN = Path('/private/tmp/slax-reader-fresh-alpha-cross-38ce646b95414adf8aabe2776c313ca4')
GRANTS = Path('/private/tmp/slax-reader-fresh-alpha-cross-grants-38ce646b95414adf8aabe2776c313ca4')
DEVICE = 'B85A7582-A0A7-4A0F-9BF0-8424330859F3'
OTHER = '88E63005-F681-45A6-AF8D-BEFE4E27584D'
NAME = 'SlaxColdShareControlled-20261011-Mg6KLJ'
DEVICE_ROOT = Path('/Users/daguang/Library/Developer/CoreSimulator/Devices') / DEVICE
UI = 'app.slax.reader.uifixture'
HELPERS = {'app.slax.reader.readernativefixture.controlhost', 'app.slax.reader.readernativefixture.control.xctrunner',
           'app.slax.reader.crossparagraphfixture.controlhost', 'app.slax.reader.crossparagraphfixture.control.xctrunner'}
XCRUN = '/usr/bin/xcrun'
XCODE = '/Applications/Xcode.app/Contents/Developer/usr/bin/xcodebuild'
NODE = '/usr/local/bin/node'
PS = '/bin/ps'
LSOF = '/usr/sbin/lsof'
METRO_PID = 93891
METRO_ARGV = '/usr/local/bin/node node_modules/expo/bin/cli start --dev-client --port 8083 --max-workers 1'
CONTROL = REPO / 'apps/mobile/tooling/fixture-control.mjs'
FIXTURE_PROJECT = REPO / 'apps/mobile/tooling/fixture-project.mjs'
LAUNCH_URL = 'slaxreader-ui-fixture://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8083'
READINESS = HERE / 'inspector-ready.mjs'
READINESS_SECONDS, READINESS_OUTER, PREPARE_OUTER = 20, 22, 25
STAGE = Path('/private/var/folders/_l/80rthvqs2251jkn7spm33_s40000gn/T/slax-reader-ui-fixture-byWKU3')
STAGE_SHA = '916255118823ed8d2764c333b4d135d0b0278b3b0edba2a38d48762ceaf2d4f3'
INPUT_SHA = 'aaf4fdd7fd8b205ed6f2e297686f20bb3f523b680d35fc62effcdc8a2a4afe2f'
UI_BUNDLE = DEVICE_ROOT / 'data/Containers/Bundle/Application/1FAEDB4E-A5DE-4810-AC13-1D1F1D0B908E'
UI_DATA = DEVICE_ROOT / 'data/Containers/Data/Application/5E637416-B35B-4D03-9D31-093B3A22A6B9'
SIGNED_MANIFEST = Path('/private/tmp/slax-reader-aw4-public-sign-ba391fab-1ee8-484d-9c95-1ecb4021ee6d/complete-signed-app-manifest.json')
ADDITIONAL = {PS, LSOF, str(REPO/'apps/mobile/fixtures/manifest.json'), str(SIGNED_MANIFEST),
              str(BASE.with_name('report.json')), str(FIXTURE_PROJECT), str(UI_BUNDLE/'SlaxReader.app/Info.plist'), str(REPO/'docs/mobile/evidence/2026-10-11-local-storekit-preparation/device-release.json')}
SELECTORS = {
    'alpha': 'ReaderNativeControl/ReaderNativeControl/testNativeLongPressOriginalBodyWord',
    'cross': 'CrossParagraphControl/ReaderCrossParagraphControl/testNativeEndHandleDragFromGenuineAlphaTowardSecondParagraph',
}
PLISTS = {'alpha': 'ReaderNativeControl_iphonesimulator26.5-arm64.xctestrun',
          'cross': 'CrossParagraphControl_iphonesimulator26.5-arm64.xctestrun'}
FLOOR, PRE, CAP, LOG_CAP = 3221225472, 3865470566, 268435456, 8388608
TOTAL, RESERVE, GRACE, TEST, UTILITY = 180, 30, 4, 45, 5
RECEIPT_RESERVE = 1048576
SHA = re.compile(r'^[a-f0-9]{64}$')
UUID = re.compile(r'^[A-Fa-f0-9]{8}(?:-[A-Fa-f0-9]{4}){3}-[A-Fa-f0-9]{12}$')


def require(value, message):
    if not value:
        raise ValueError(message)


def regular(path):
    require(path.is_absolute() and all(not p.is_symlink() for p in (path, *path.parents)), 'Relative/symlink input refused')
    value = path.lstat()
    require(stat.S_ISREG(value.st_mode), 'Nonregular file refused')
    return value


def sha(path):
    regular(path)
    digest = hashlib.sha256()
    with path.open('rb') as source:
        for chunk in iter(lambda: source.read(1048576), b''):
            digest.update(chunk)
    return digest.hexdigest()


def bound(entry):
    require(set(entry) == {'path', 'bytes', 'sha256'} and SHA.fullmatch(entry['sha256']), 'Unclosed public binding')
    path = Path(entry['path'])
    require(regular(path).st_size == entry['bytes'] and sha(path) == entry['sha256'], 'Changed public binding: ' + str(path))
    return path


def relative(text):
    path = Path(text)
    require(not path.is_absolute() and path.as_posix() == text and bool(path.parts) and all(p not in ('.', '..') for p in path.parts), 'Unsafe relative path')
    require(not any(re.search(r'^(?:\.env|\.dev\.vars|google-services|googleservice)|credential|private.?key|\.p12$|\.mobileprovision$', p, re.I) for p in path.parts), 'Operator filename refused before read')
    return path


def tree(root, active=False):
    """Count root, every directory and regular file; no sparse/size exceptions."""
    if not root.exists():
        require(not root.is_symlink(), 'Dangling root symlink refused')
        return {'logicalBytes': 0, 'allocatedBytes': 0, 'files': 0}
    value = root.lstat(); require(stat.S_ISDIR(value.st_mode), 'Unsafe accounting root')
    logical, allocated, files, visited = 0, value.st_blocks * 512, 0, 0
    def on_error(error):
        raise error
    for directory, dirs, names in os.walk(root, followlinks=False, onerror=on_error):
        for name in [*dirs, *names]:
            path = Path(directory) / name
            try:
                value = path.lstat()
            except FileNotFoundError:
                # Only simulator-owned transient files within already admitted helper
                # containers may disappear while the tracked XCTest is alive.
                require(active and path.is_relative_to(DEVICE_ROOT / 'data/Containers'), 'Unbounded accounting race')
                continue
            visited += 1; require(visited <= 30000, 'Accounting entry cap')
            require(stat.S_ISREG(value.st_mode) or stat.S_ISDIR(value.st_mode), 'Symlink/nonregular accounting entry refused')
            allocated += value.st_blocks * 512
            if stat.S_ISREG(value.st_mode):
                logical += value.st_size; files += 1
    return {'logicalBytes': logical, 'allocatedBytes': allocated, 'files': files}


def records(root):
    tree(root)
    result = []
    for directory, _, files in os.walk(root, followlinks=False):
        for name in files:
            path = Path(directory) / name; item = regular(path)
            name=path.relative_to(root).as_posix();relative(name)
            result.append({'relativePath': name, 'bytes': item.st_size,
                           'mode': stat.S_IMODE(item.st_mode), 'sha256': sha(path)})
    return sorted(result, key=lambda e: e['relativePath'])


def verify_app(root, expected):
    # Name/type closed set is checked before reading any bundle file, so a newly
    # supplied operator filename cannot enter a read-only ancestry audit.
    tree(root);names=[]
    for directory,_,files in os.walk(root,followlinks=False):
        names.extend((Path(directory)/name).relative_to(root).as_posix() for name in files)
    require(set(names)=={e['relativePath'] for e in expected} and len(names)==148,'Unexpected installed UI bundle file')
    for e in expected:bound({'path':str(root/relative(e['relativePath'])),'bytes':e['bytes'],'sha256':e['sha256']})


def verify_records(root, expected):
    closed = [{k: e[k] for k in ('relativePath', 'bytes', 'mode', 'sha256')} for e in expected]
    require(len({e['relativePath'] for e in closed}) == len(closed), 'Duplicate manifest row')
    for e in closed:
        relative(e['relativePath'])
    require(records(root) == sorted(closed, key=lambda e: e['relativePath']), 'Closed public tree changed: ' + str(root))


def identities():
    """Only MCM identity metadata; never inspect unowned app/container contents."""
    found = {}
    for kind in ('Bundle', 'Data'):
        base = DEVICE_ROOT / 'data/Containers' / kind / 'Application'
        require(base.is_dir() and not base.is_symlink(), 'Missing/unsafe container registry')
        paths = list(base.iterdir()); require(len(paths) <= 2000, 'Container metadata bound')
        for root in paths:
            require(root.is_dir() and not root.is_symlink() and UUID.fullmatch(root.name), 'Unsafe container entry')
            marker = root / '.com.apple.mobile_container_manager.metadata.plist'
            if marker.exists():
                require(regular(marker).st_size <= 65536, 'Oversized identity metadata')
                found[str(root)] = plistlib.loads(marker.read_bytes()).get('MCMMetadataIdentifier')
            else:
                found[str(root)] = None
    return found


def helper_accounting(baseline, active=False):
    current = identities(); entries = []
    for path, identity in current.items():
        if path in baseline:
            require(identity == baseline[path], 'Existing container identity changed')
        else:
            require(identity in HELPERS or (active and identity is None), 'Unexpected new non-helper container refused')
        if identity in HELPERS or path not in baseline:
            entries.append({'path': path, 'identifier': identity, **tree(Path(path), active)})
    # XCTest may replace an installed helper's Bundle UUID. Replacements remain
    # closed to exact helper identifiers and are all counted; the UI app/data
    # containers are protected and cannot be replaced by this no-install flow.
    require(all(path in current for path, identity in baseline.items() if identity == UI), 'Protected UI container vanished')
    return {'containers': entries, 'logicalBytes': sum(e['logicalBytes'] for e in entries),
            'allocatedBytes': sum(e['allocatedBytes'] for e in entries)}


def free_bytes():
    value = os.statvfs('/private/tmp'); return value.f_bavail * value.f_frsize


def scope_metadata_baseline(data_root):
    """Direct child names/lstat only; never inspect an existing scope's contents."""
    require(data_root == UI_DATA and all(not p.is_symlink() for p in (data_root, *data_root.parents)), 'Unclosed UI data root')
    base = data_root / 'Library/Caches/slax-ui-fixtures'
    require(all(not p.is_symlink() for p in (base, *base.parents)), 'Unsafe UI scope parent')
    if not base.exists():
        return {'parent': str(base), 'parentExisted': False, 'children': {}}
    require(stat.S_ISDIR(base.lstat().st_mode), 'UI scope parent is not a directory')
    children = list(base.iterdir()); require(len(children) <= 1000, 'Scope metadata baseline bound')
    rows = {}
    for child in children:
        item = child.lstat()
        require(stat.S_ISDIR(item.st_mode), 'Existing scope child symlink/non-directory refused')
        rows[child.name] = {'mode': item.st_mode, 'device': item.st_dev, 'inode': item.st_ino,
                            'logicalBytes': item.st_size, 'allocatedBytes': item.st_blocks * 512}
    return {'parent': str(base), 'parentExisted': True, 'children': rows}


def fresh_scope_accounting(data_root, baseline, seen, current_scope=None):
    """Only new, marker-proved reader/bootstrap scopes enter the unchanged cap."""
    require(data_root == UI_DATA, 'Unclosed UI data root')
    base = data_root / 'Library/Caches/slax-ui-fixtures'
    require(baseline['parent'] == str(base) and all(not p.is_symlink() for p in (base, *base.parents)), 'Different/symlink scope parent')
    if not base.exists():
        require(not baseline['parentExisted'] and current_scope is None and not seen, 'Scope parent vanished')
        return {'scopes': [], 'seenNewScopeNames': [], 'logicalBytes': 0, 'allocatedBytes': 0}
    parent = base.lstat(); require(stat.S_ISDIR(parent.st_mode), 'Scope parent must be a directory')
    children = list(base.iterdir()); require(len(children) <= 1002, 'Scope child metadata bound')
    names = {p.name for p in children}
    require(set(baseline['children']) <= names, 'Existing scope directory vanished')
    require(len(set(seen) | (names - set(baseline['children']))) <= 2, 'More than one reader and one bootstrap scope refused')
    entries = []
    for child in children:
        item = child.lstat(); require(stat.S_ISDIR(item.st_mode), 'Scope child symlink/non-directory refused')
        if child.name in baseline['children']:
            prior = baseline['children'][child.name]
            require((item.st_mode, item.st_dev, item.st_ino) == (prior['mode'], prior['device'], prior['inode']), 'Existing scope metadata identity changed')
            continue
        match = re.fullmatch(r'(reader-mixed|library-populated)-[0-9]+-[a-f0-9]+', child.name)
        require(match is not None, 'Unknown new scope name refused before marker read')
        scenario = match.group(1)
        marker = child / 'slax-fixture.json'
        require(regular(marker).st_size <= 1024, 'Fresh scope marker exceeds1KiB')
        raw = marker.read_bytes()
        value = json.loads(raw)
        require(isinstance(value, dict) and value.get('controlledFixture') is True and type(value.get('fixtureVersion')) is int and
                value == {'controlledFixture': True, 'fixtureVersion': 1, 'scenario': scenario, 'inputSha256': INPUT_SHA}, 'Unknown new scope marker refused')
        require(not any(name != child.name and row['scenario'] == scenario for name, row in seen.items()), 'More than one reader and one bootstrap scope refused')
        require(child.name not in seen or seen[child.name]['scenario'] == scenario, 'New scope identity changed')
        # Marker proof precedes metadata-only tree accounting. No SQLite, HTML,
        # image or old scope content is read by the resource watcher.
        seen[child.name] = {'scenario': scenario, 'markerSHA256': hashlib.sha256(raw).hexdigest()}
        require(len(seen) <= 2 and len({row['scenario'] for row in seen.values()}) == len(seen), 'More than one reader and one bootstrap scope refused')
        if current_scope is not None and scenario == 'reader-mixed':
            require(current_scope == child.as_uri() + '/', 'New Reader scope differs from exact controller scope')
        entries.append({'path': str(child), 'scenario': scenario, 'markerSHA256': seen[child.name]['markerSHA256'], **tree(child)})
    if current_scope is not None:
        require(any(row['scenario'] == 'reader-mixed' and current_scope == Path(row['path']).as_uri() + '/' for row in entries), 'Exact current Reader scope missing or predates launch')
    # A newly created parent belongs to this run; an existing parent is only
    # enumerated, never charged as though its historical contents were new.
    parent_logical = 0 if baseline['parentExisted'] else parent.st_size
    parent_allocated = 0 if baseline['parentExisted'] else parent.st_blocks * 512
    return {'scopes': entries, 'seenNewScopeNames': sorted(seen), 'newParentLogicalBytes': parent_logical,
            'newParentAllocatedBytes': parent_allocated,
            'logicalBytes': sum(row['logicalBytes'] for row in entries) + parent_logical,
            'allocatedBytes': sum(row['allocatedBytes'] for row in entries) + parent_allocated}


def resource_guard(own, helpers, free, logs, initial=False, scopes=None):
    scopes = scopes or {'logicalBytes': 0, 'allocatedBytes': 0}
    require(free >= (PRE if initial else FLOOR), '3GiB free floor / 0.6GiB admission reserve crossed')
    require(own['logicalBytes'] + helpers['logicalBytes'] + scopes['logicalBytes'] + RECEIPT_RESERVE <= CAP and
            own['allocatedBytes'] + helpers['allocatedBytes'] + scopes['allocatedBytes'] + RECEIPT_RESERVE <= CAP, 'All distinct owned artifacts exceed256MiB')
    require(logs <= LOG_CAP, 'Combined command logs exceed8MiB')


def remaining_for_cross(elapsed):
    require(TOTAL - elapsed >= TEST + RESERVE + GRACE, 'Live handoff no longer has45+30+4 seconds')


def metro_ownership(raw_argv, raw_cwd):
    """Exact observed CLI plus independent owned-PID cwd; no text substring."""
    require(raw_argv == (METRO_ARGV + '\n').encode(), 'Owned Metro exact CLI argv differs')
    fields = raw_cwd.splitlines(keepends=True)
    require(fields == [f'p{METRO_PID}\n'.encode(), b'fcwd\n', ('n' + str(STAGE) + '\n').encode()],
            'Owned Metro exact PID/cwd fields differ')
    return {'ownedPID': METRO_PID, 'argv': METRO_ARGV, 'cwd': str(STAGE),
            'psRawSHA256': hashlib.sha256(raw_argv).hexdigest(),
            'lsofRawSHA256': hashlib.sha256(raw_cwd).hexdigest(),
            'cwdFields': ['p' + str(METRO_PID), 'fcwd', 'n' + str(STAGE)]}


def verify_stage():
    marker = STAGE / '.slax-ui-fixture-project.json'
    require(sha(marker) == STAGE_SHA, 'Frozen stage marker changed')
    entries = json.loads(marker.read_text())['generatedSourceDigests']
    require(len(entries) == 377 and len({e['path'] for e in entries}) == 377, 'Wrong staged source closure')
    for e in entries:
        require(sha(STAGE / relative(e['path'])) == e['sha256'], 'Frozen stage source changed')


def product_manifest(binding, count):
    manifest = json.loads(bound(binding).read_text())
    entries = manifest.get('files', manifest.get('regularFiles'))
    require(len(entries) == count, 'Wrong compiled product count')
    root = Path(manifest['root']); verify_records(root, entries)
    return root, entries


def inspector_startup_policy():
    return {'scheme':'slaxreader-ui-fixture','url':LAUNCH_URL,'appId':UI,
            'infoPath':str(UI_BUNDLE/'SlaxReader.app/Info.plist'),
            'infoSHA256':'959fc81fc00bc81f893a39139b85c99c35b0abbe3718722046baf9e7d84f971c',
            'fixtureProjectPath':str(FIXTURE_PROJECT),
            'readinessCommand':[NODE,str(READINESS),str(RUN)],
            'readinessMilliseconds':20000,'requestMilliseconds':2000,'maximumRequests':80,
            'inventoryURL':'http://127.0.0.1:8083/json/list','inventoryBytes':65536,'inventoryEntries':200,
            'readinessOuterSeconds':READINESS_OUTER,'prepareOuterSeconds':PREPARE_OUTER,
            'uniqueAppIdAndDeviceName':True,'sameProductionInspectorContract':True,
            'websocketInReadiness':False,'readinessExpressions':False,'metroRestartAllowed':False,
            'totalSecondsUnchanged':TOTAL,'releaseSecondsUnchanged':RESERVE}


def verify_launch_configuration(info, source):
    require(info.get('CFBundleIdentifier')==UI and info.get('CFBundleShortVersionString')=='1.0.0' and
            info.get('CFBundleVersion')=='1', 'Different installed UI public identity/version')
    types=info.get('CFBundleURLTypes'); require(isinstance(types,list),'Missing installed URL types')
    schemes=[s for row in types for s in row.get('CFBundleURLSchemes',[])]
    require(schemes.count('slaxreader-ui-fixture')==1 and schemes==[
        'slaxreader-ui-fixture','app.slax.reader.uifixture','exp+slax-reader-ui-fixture'],
        'Different installed148 independent scheme closure')
    require("SCHEME = 'slaxreader-ui-fixture';" in source and
        "const launchUrl = `${SCHEME}://expo-development-client/?url=${encodeURIComponent('http://127.0.0.1:8083')}`;" in source and
        'xcrun simctl openurl "$SLAX_FIXTURE_SIMULATOR" ${q(launchUrl)}' in source,
        'Bound public fixture generator deep-link provenance differs')


def verify_devices_shutdown():
    for udid in (DEVICE, OTHER):
        path = DEVICE_ROOT.parent / udid / 'device.plist'; regular(path)
        data = plistlib.loads(path.read_bytes())
        require(data['UDID'] == udid and data['state'] == 1, 'Owned migration loan is not Shutdown')
        if udid == DEVICE:
            require(data['name'] == NAME and data['deviceType'] == 'com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro' and
                    data['runtime'] == 'com.apple.CoreSimulator.SimRuntime.iOS-26-5', 'Owned device template changed')


def admission():
    require(sha(BASE) == BASE_SHA, 'Prepared plan changed')
    plan = json.loads(BASE.read_text()); regular(POLICY); policy = json.loads(POLICY.read_text())
    require(policy['kind'] == 'fresh-native-alpha-cross-runtime-policy' and policy['version'] == 1 and
            policy['basePlanSHA256'] == BASE_SHA and policy['runRoot'] == str(RUN) and policy['grantRoot']==str(GRANTS), 'Wrong prepared runtime policy')
    require(policy['limits'] == {'globalSeconds': TOTAL, 'releaseSeconds': RESERVE, 'killGraceSeconds': GRACE,
            'testSeconds': TEST, 'utilitySeconds': UTILITY, 'preFreeBytes': PRE, 'floorBytes': FLOOR,
            'logicalAndAllocatedCapBytes': CAP, 'combinedLogCapBytes': LOG_CAP, 'receiptReserveBytes': RECEIPT_RESERVE}, 'Resource bounds cannot change')
    require(policy['freshScopeAccounting'] == {'parent': str(UI_DATA / 'Library/Caches/slax-ui-fixtures'), 'maximumNewScopes': 2,
            'allowedCases': ['reader-mixed', 'library-populated'], 'markerBytes': 1024,
            'inputSHA256': INPUT_SHA, 'oldScopeContentsRead': False, 'sqliteContentsRead': False,
            'same256MiBCap': True}, 'Fresh scope accounting cannot expand')
    require(policy['metroOwnerObservation'] == {'ownedPID': METRO_PID, 'exactCLIArgv': METRO_ARGV,
            'cwd': str(STAGE), 'lsofArgv': [LSOF, '-a', '-p', str(METRO_PID), '-d', 'cwd', '-Fn'],
            'exactCwdFields': ['p' + str(METRO_PID), 'fcwd', 'n' + str(STAGE)],
            'requiresUnchanged377Stage': True, 'metroRestartAllowed': False}, 'Metro owner observation cannot expand')
    require(policy['inspectorStartup']==inspector_startup_policy(), 'Inspector launch/readiness cannot expand')
    require(len(policy['ownInputs'])==6 and {e['path'] for e in policy['ownInputs']} == {str(Path(__file__).resolve()), str(HERE/'runtime-guards.test.py'),
            str(HERE/'snapshot-check.mjs'), str(HERE/'installed-helpers-forward-admission.json'),
            str(READINESS), str(HERE/'inspector-ready.test.mjs')}, 'Unclosed executor inputs')
    require({e['path'] for e in policy['additionalPublicInputs']} == ADDITIONAL and len(policy['additionalPublicInputs'])==len(ADDITIONAL), 'Unclosed additional public files')
    for e in policy['ownInputs'] + policy['additionalPublicInputs']:
        bound(e)
    for e in [plan['fixtureInputs'], plan['runtimeCompiledAppAncestry'], plan['actualBitmapPrerequisite'],
              plan['alphaBuildAncestry'], plan['alphaCurrentProducts'], plan['alphaOriginalPlist'], plan['crossBuildRootReview'],
              plan['crossOriginal53Products'], plan['acceptedExistingCrossHelperContainers'], plan['metro']['ownerReceipt'],
              plan['hostNode'], *plan['publicControlInputs'], *plan['nativeUtilities']]:
        bound(e)
    alpha = product_manifest(plan['alphaCurrentProducts'], 63); cross = product_manifest(plan['crossOriginal53Products'], 53)
    for phase, (root, _) in [('alpha', alpha), ('cross', cross)]:
        value = plistlib.loads((root/PLISTS[phase]).read_bytes()); target_name = SELECTORS[phase].split('/')[0]
        require(set(value) == {target_name, '__xctestrun_metadata__'} and value['__xctestrun_metadata__']['FormatVersion'] == 1, 'Only actual v1 xctestrun is admitted')
        target = value[target_name]
        require(target['TestHostBundleIdentifier'] in HELPERS and target['UITargetAppPath'].startswith('__TESTROOT__/Debug-iphonesimulator/') and
                target['TestHostPath'].startswith('__TESTROOT__/Debug-iphonesimulator/'), 'Unexpected helper resolution/identity')
    verify_stage(); verify_devices_shutdown()
    baseline = identities()
    installed = json.loads((HERE/'installed-helpers-forward-admission.json').read_text())
    require(set(installed) == {'kind', 'crossAcceptedSHA256', 'alphaCompiledProductsSHA256', 'containers'} and
            installed['crossAcceptedSHA256'] == plan['acceptedExistingCrossHelperContainers']['sha256'] and
            installed['alphaCompiledProductsSHA256'] == plan['alphaCurrentProducts']['sha256'], 'Wrong forward-admission ancestry')
    require({path for path, identity in baseline.items() if identity in HELPERS} == {e['path'] for e in installed['containers']}, 'Unexpected installed task helper')
    for e in installed['containers']:
        require(baseline[e['path']] == e['identifier'] and e['identifier'] in HELPERS, 'Wrong admitted helper identity')
        verify_records(Path(e['path']), e['files'])
    app = policy['installedUI']
    require(set(app)=={'bundleRoot','dataRoot','appRoot','files','executableSHA256','debugDylibSHA256'} and app['bundleRoot']==str(UI_BUNDLE) and
            app['dataRoot']==str(UI_DATA) and app['appRoot']==str(UI_BUNDLE/'SlaxReader.app'), 'Unclosed installed UI roots')
    source_manifest=json.loads(SIGNED_MANIFEST.read_text())
    expected=[{'relativePath':e['path'],'bytes':e['bytes'],'sha256':e['sha256']} for e in source_manifest['entries'] if e['kind']=='file']
    require(len(app['files'])==148 and app['files']==expected, 'Installed app differs from complete signed ancestry')
    require(baseline[app['bundleRoot']] == UI and baseline[app['dataRoot']] == UI, 'Wrong installed UI identity')
    verify_app(Path(app['appRoot']),app['files'])
    verify_launch_configuration(plistlib.loads((UI_BUNDLE/'SlaxReader.app/Info.plist').read_bytes()),FIXTURE_PROJECT.read_text())
    require(not RUN.exists() and not RUN.is_symlink(), 'Never reuse this one-attempt root')
    resource_guard({'logicalBytes': 0, 'allocatedBytes': 0}, helper_accounting(baseline), free_bytes(), 0, True)
    return plan, policy, {'alpha': alpha, 'cross': cross}, baseline


def grant(path, expected_sha, phase, policy):
    require(path == GRANTS / (phase+'-allocation.json') and SHA.fullmatch(expected_sha), 'Only exact fresh Root grant path/SHA allowed')
    require(sha(path) == expected_sha and regular(path).st_size <= 16384, 'Changed/oversize grant')
    value = json.loads(path.read_text())
    expected = {'kind': 'root-one-fresh-native-'+phase+'-allocation', 'version': 1, 'phase': phase,
        'executorSHA256': sha(Path(__file__).resolve()), 'runtimePolicySHA256': sha(POLICY), 'basePlanSHA256': BASE_SHA,
        'runRoot': str(RUN), 'device': DEVICE, 'ownedMigrationDevices': [DEVICE, OTHER], 'exclusiveDeviceLoan': True,
        'onlyTestIdentifier': SELECTORS[phase], 'attempts': 1, 'noNativeCompile': True}
    extra = {'nonce', 'expiresAtUnixSeconds'} if phase == 'alpha' else {'nonce', 'expiresAtUnixSeconds', 'alphaAllocationSHA256',
        'ownerPID', 'windowStartedUnixSeconds', 'alphaReportSHA256', 'alphaSnapshotSHA256', 'rawAlphaSummarySHA256',
        'rawAlphaXCResultManifestSHA256', 'rootIndependentReviewSHA256', 'scopeUri', 'cacheKey', 'pageId', 'nativeTag'}
    require(set(value) == set(expected) | extra and all(value[k] == v for k,v in expected.items()), 'Unclosed/wrong grant scope')
    require(UUID.fullmatch(value['nonce']) and type(value['expiresAtUnixSeconds']) in (int,float) and time.time() < value['expiresAtUnixSeconds'], 'Missing/expired fresh nonce')
    return value


def scope_path(value, data_root):
    parsed = urlparse(value)
    require(parsed.scheme == 'file' and not parsed.netloc and not parsed.query and not parsed.fragment and '%' not in parsed.path,
            'Noncanonical scope URI')
    root = Path(parsed.path)
    base = data_root / 'Library/Caches/slax-ui-fixtures'
    require(root.parent == base and re.fullmatch(r'reader-mixed-[0-9]+-[a-f0-9]+',root.name) and value == root.as_uri()+'/', 'Different/unscoped UI directory')
    require(root.is_dir() and all(not p.is_symlink() for p in (root,*root.parents)), 'Unsafe exact scope')
    return root


def context(value, scope=None):
    require(value['appId'] == UI and value['device'] == NAME and value['scenario'] == 'reader-mixed' and
            value['inputSha256'] == INPUT_SHA and value['locale'] == 'en' and value['nativeInteractionVerified'] is False, 'Wrong fixture controller identity')
    require(scope is None or value['scopeUri'] == scope, 'Live UI scope changed')
    data = value['renderContext']; m=data['nativeMeasurements']
    require(data['controlledFixture'] is True and data['fixtureVersion']==1 and data['scenario']=='reader-mixed' and
            data['inputSha256']==INPUT_SHA and data['locale']=='en' and data['observedRoute']['name']=='Reader', 'Wrong current Reader scope')
    require(m['platform']=='ios' and m['osVersion']=='26.5' and m['viewport']=={'fontScale':1,'width':402,'height':874,'scale':3} and
            m['fontScale']==1 and m['pixelRatio']==3 and m['safeArea']=={'top':62,'right':0,'bottom':34,'left':0} and m['appearance']=='light', 'Wrong native conditions')
    actions=data['preparedActions']; require(len(actions)<=20 and all(e['action'] in ({'kind':'inspect-position'},{'kind':'inspect-selection'}) and
            e['handler']=='reader' and e['nativeInteractionVerified'] is False for e in actions), 'Unapproved DOM/fixture action occurred')
    return data


def position(value):
    b=value['bridge']; g=value['geometry']; observed=value.get('observed',{}).get('positionPixels')
    require(value['controlledFixture'] is True and value['fixtureVersion']==1 and value['requestedPixels']==240 and value['consumed'] is True and
            type(observed) in (int,float) and abs(observed-240)<=0.5 and b['ready'] is True and b['documentLoaded'] is True and
            b['loadStarts']==1 and b['loadEnds']==1 and b['rejectedMessages']==0 and type(b['nativeTag']) is int and b['nativeTag']>0 and
            isinstance(b['pageId'],str) and b['pageId'] and g['pixelRatio']==3 and g['containerScreenTopPoints']==0 and
            g['webViewScreenTopPoints']==0 and g['viewportHeightPoints']==874, 'Not actual ready full-window240 native position')


def exact_summary(value, phase):
    require(value['result']=='Passed' and value['totalTestCount']==1 and value['passedTests']==1 and value['failedTests']==0 and
            value['skippedTests']==0 and value['expectedFailures']==0 and value['testFailures']==[], 'Native exact1pass0fail0skip absent')
    rows=value['devicesAndConfigurations']; require(len(rows)==1 and rows[0]['device']['deviceId']==DEVICE and
            rows[0]['device']['architecture']=='arm64' and rows[0]['device']['osVersion']=='26.5', 'Native summary wrong device')
    require(value['title'] == 'Test - '+SELECTORS[phase].split('/')[0] and value['finishTime']>=value['startTime'], 'Wrong/unfinished native suite')


def exact_test_nodes(value, phase):
    cases=[]
    def walk(nodes):
        for node in nodes:
            if node.get('nodeType')=='Test Case': cases.append(node)
            walk(node.get('children',[]))
    walk(value['testNodes'])
    expected='/'.join(SELECTORS[phase].split('/')[1:])+'()'
    require(len(cases)==1 and cases[0]['nodeIdentifier']==expected and cases[0]['result']=='Passed', 'Wrong native selector/result')


def cross_barrier(value, live, report, summary_sha, manifest_sha, independent):
    require(value['alphaAllocationSHA256']==live['alphaAllocationSHA256'] and value['ownerPID']==live['ownerPID'] and
            value['windowStartedUnixSeconds']==live['windowStartedUnixSeconds'] and value['nonce']!=live['alphaNonce'], 'Different owner/window or reused grant')
    for key in ('scopeUri','cacheKey','pageId','nativeTag'):
        require(value[key]==live[key], 'Cross grant changed live '+key)
    require(value['alphaReportSHA256']==sha(RUN/'alpha-report.json') and value['alphaSnapshotSHA256']==sha(RUN/'snapshots/alpha/reader-selection.json') and
            value['rawAlphaSummarySHA256']==summary_sha and value['rawAlphaXCResultManifestSHA256']==manifest_sha, 'Cross grant does not bind fresh raw Alpha')
    expected={'kind':'root-independent-fresh-alpha-and-live-continuation-review','version':1,'accepted':True,
              'device':DEVICE,'scopeUri':live['scopeUri'],'cacheKey':live['cacheKey'],'pageId':live['pageId'],'nativeTag':live['nativeTag'],
              'alphaReportSHA256':value['alphaReportSHA256'],'alphaSnapshotSHA256':value['alphaSnapshotSHA256'],
              'rawAlphaSummarySHA256':summary_sha,'rawAlphaXCResultManifestSHA256':manifest_sha,
              'actualNativeBlueHandlesAndMenuReviewed':True,'actualNative240Reviewed':True,'noPreparedDOMRange':True,
              'noSyntheticSelectionEvent':True,'singleNativeAlphaPressReviewed':True,'onlyCurrent377Scope':True}
    require(set(independent)==set(expected) and independent==expected, 'Missing independent raw Alpha/current snapshot review')
    require(report['scopeUri']==live['scopeUri'] and report['publisherBuild'] is False, 'Different Alpha report')


def test_command(phase):
    return [XCODE,'test-without-building','-xctestrun',str(RUN/(phase+'-Products')/PLISTS[phase]),
            '-destination','platform=iOS Simulator,id='+DEVICE,'-parallel-testing-enabled','NO',
            '-maximum-concurrent-test-simulator-destinations','1','-jobs','1','-only-testing:'+SELECTORS[phase],
            '-resultBundlePath',str(RUN/(phase+'.xcresult'))]


def control_command(kind):
    prefix=[NODE,str(CONTROL),'--platform','ios','--device',NAME]
    if kind=='prepare': return prefix+['--case','reader-mixed','--locale','en','--font-scale','1']
    require(kind in ('inspect-position','inspect-selection','observe'), 'Only readonly continuation actions')
    return prefix+(['--observe','current'] if kind=='observe' else ['--action',json.dumps({'kind':kind},separators=(',',':'))])


def exact_command(argv):
    sim=[XCRUN,'simctl']; allowed=[sim+['list','devices','--json'],sim+['boot',DEVICE],sim+['bootstatus',DEVICE,'-b'],
        sim+['status_bar',DEVICE,'override','--time','09:41'],sim+['ui',DEVICE,'appearance','light'],sim+['ui',DEVICE,'content_size','large'],
        sim+['openurl',DEVICE,LAUNCH_URL],[NODE,str(READINESS),str(RUN)],sim+['status_bar',DEVICE,'clear'],sim+['shutdown',DEVICE],
        *[sim+['terminate',DEVICE,i] for i in sorted(HELPERS|{UI})], [PS,'-p',str(METRO_PID),'-o','command='],
        [LSOF,'-a','-p',str(METRO_PID),'-d','cwd','-Fn'],
        *[test_command(p) for p in SELECTORS], *[control_command(k) for k in ('prepare','inspect-position','inspect-selection','observe')]]
    for phase in SELECTORS:
        allowed += [[XCRUN,'xcresulttool','get','test-results',kind,'--path',str(RUN/(phase+'.xcresult'))] for kind in ('summary','tests')]
        allowed += [[XCRUN,'xcresulttool','export','attachments','--path',str(RUN/(phase+'.xcresult')),'--output-path',str(RUN/(phase+'-attachments'))]]
    for mode in ('alpha','cross'):
        allowed += [[NODE,str(HERE/'snapshot-check.mjs'),mode,str(RUN)]]
    require(argv in allowed, 'Unallocated command/selector refused')


class Executor:
    def __init__(self, policy, products, baseline, allocation, allocation_sha):
        self.policy,self.products,self.baseline=policy,products,baseline
        self.started=time.monotonic(); self.started_unix=time.time(); self.process=None; self.boot=False
        self.commands=[]; self.samples=[]; self.scope=None; self.live=None
        self.scope_baseline = scope_metadata_baseline(UI_DATA); self.fresh_scopes_seen = {}
        self.receipt={'kind':'fresh-native-alpha-cross-one-owner-attempt','version':1,'executorSHA256':sha(Path(__file__).resolve()),
            'runtimePolicySHA256':sha(POLICY),'basePlanSHA256':BASE_SHA,'device':DEVICE,'ownerPID':os.getpid(),
            'windowStartedUnixSeconds':self.started_unix,'alphaAllocationSHA256':allocation_sha,'alphaNonce':allocation['nonce'],
            'commands':self.commands,'resourceSamples':self.samples,'status':'started',
            'scopeMetadataBaseline':self.scope_baseline,'crossNativeCommandIssued':False,'crossActualInputStatus':'not-issued',
            'crossPostInputScopeAccepted':False,
            'nativeAlphaAccepted':False,'nativeCrossAccepted':False,'publisherBuild':False,'sourceDirectKotlinCallback':False}
        RUN.mkdir(mode=0o700);(RUN/'logs').mkdir();(RUN/'tmp').mkdir();(RUN/'snapshots').mkdir(); self.save()

    def remaining(self): return TOTAL-(time.monotonic()-self.started)

    def write(self, path, value):
        require(path.is_relative_to(RUN) and not path.is_symlink(), 'Only owned receipt writes')
        path.parent.mkdir(parents=True,exist_ok=True)
        temporary=path.with_name(path.name+'.tmp');require(not temporary.is_symlink(),'Unsafe receipt temporary')
        temporary.write_text(json.dumps(value,indent=2)+'\n');temporary.replace(path)

    def save(self): self.write(RUN/'receipt.json',self.receipt)

    def resources(self, active=False):
        own=tree(RUN); installed=helper_accounting(self.baseline,active)
        fresh_scopes = fresh_scope_accounting(UI_DATA, self.scope_baseline, self.fresh_scopes_seen, self.scope)
        logs=sum(regular(p).st_size for p in (RUN/'logs').iterdir())
        sample={'elapsedSeconds':TOTAL-self.remaining(),'freeBytes':free_bytes(),'owned':own,'helpers':installed,'freshUIScopes':fresh_scopes,'logBytes':logs}
        require(len(self.samples)<1024,'Resource sampler bound');self.samples.append(sample)
        resource_guard(own,installed,sample['freeBytes'],logs,scopes=fresh_scopes)
        return sample

    def stop(self, process):
        if process.poll() is None:
            require(os.getpgid(process.pid)==process.pid,'Refuse another process group')
            os.killpg(process.pid,signal.SIGTERM)
            try: process.wait(timeout=min(GRACE,max(.1,self.remaining())))
            except subprocess.TimeoutExpired: os.killpg(process.pid,signal.SIGKILL);process.wait(timeout=1)

    def command(self, argv, seconds=UTILITY, release=False):
        exact_command(argv)
        budget=min(seconds,self.remaining()-GRACE-(0 if release else RESERVE))
        index=len(self.commands); out=RUN/'logs'/f'{index:02d}.stdout';err=RUN/'logs'/f'{index:02d}.stderr'
        record={'argv':argv,'timeoutSeconds':budget,'ownedPID':None,'exitCode':None,'stopped':None,'stdout':str(out),'stderr':str(err)}
        self.commands.append(record);self.save();started=time.monotonic();process=None
        try:
            require(budget>0,'No command/release time remains')
            if not release:self.resources()
            env={'PATH':'/usr/bin:/bin:/usr/sbin:/sbin','DEVELOPER_DIR':'/Applications/Xcode.app/Contents/Developer','TMPDIR':str(RUN/'tmp')}
            for k in ('HOME','USER','LOGNAME'):
                if k in os.environ:env[k]=os.environ[k]
            with out.open('xb') as stdout,err.open('xb') as stderr:
                process=subprocess.Popen(argv,stdout=stdout,stderr=stderr,cwd=RUN,env=env,start_new_session=True)
                self.process=process;record['ownedPID']=process.pid
                if argv == test_command('cross'):
                    self.receipt['crossNativeCommandIssued'] = True
                    self.receipt['crossNativeCommandPID'] = process.pid
                    self.receipt['crossActualInputStatus'] = 'unknown-after-native-command'
                self.save()
                while process.poll() is None:
                    require(time.monotonic()-started<budget,'Owned command deadline exhausted')
                    if release:
                        require(sum(regular(p).st_size for p in (RUN/'logs').iterdir())<=LOG_CAP,'Release logs crossed cap')
                    else:self.resources(active=argv[0]==XCODE)
                    time.sleep(.25)
                record['exitCode']=process.returncode
            require(record['exitCode']==0 or release,'Allocated command exited nonzero')
            if not release:self.resources()
            return out
        except Exception as failure:
            record['stopped']=type(failure).__name__+': '+str(failure)
            if process is not None:
                self.stop(process);record['exitCode']=process.returncode
            raise
        finally:
            self.process=None;record['elapsedSeconds']=time.monotonic()-started
            for prefix,path in [('stdout',out),('stderr',err)]:
                if path.exists():record[prefix+'SHA256']=sha(path);record[prefix+'Bytes']=regular(path).st_size
            self.save()

    def check_devices(self,path,shutdown):
        devices=[d for rows in json.loads(path.read_text())['devices'].values() for d in rows]
        for udid,state in [(DEVICE,'Shutdown' if shutdown else 'Booted'),(OTHER,'Shutdown')]:
            selected=[d for d in devices if d['udid']==udid]
            require(len(selected)==1 and selected[0]['state']==state,'Owned device state differs')
        self.receipt['unrelatedStateMetadata']=[{k:d[k] for k in ('udid','name','state','isAvailable') if k in d} for d in devices if d['udid'] not in (DEVICE,OTHER)]

    def copy_products(self):
        for phase,(source,entries) in self.products.items():
            destination=RUN/(phase+'-Products');destination.mkdir()
            for e in entries:
                require(self.remaining()>RESERVE,'Copy deadline exhausted');self.resources()
                src=source/relative(e['relativePath']);dst=destination/relative(e['relativePath']);dst.parent.mkdir(parents=True,exist_ok=True)
                with src.open('rb') as inp,dst.open('xb') as out:
                    for chunk in iter(lambda:inp.read(1048576),b''):out.write(chunk)
                dst.chmod(e['mode'])
            verify_records(destination,entries);verify_records(source,entries)

    def capture(self, name, selection=True):
        observed=json.loads(self.command(control_command('observe')).read_text());context(observed,self.scope)
        if self.scope is None:
            self.scope=observed['scopeUri'];self.scope_root=scope_path(self.scope,Path(self.policy['installedUI']['dataRoot']))
        path=self.command(control_command('inspect-position'));context(json.loads(path.read_text()),self.scope)
        if selection:
            for observed_attempt in range(3):
                path=self.command(control_command('inspect-selection'));context(json.loads(path.read_text()),self.scope)
                current=json.loads((self.scope_root/'reader-selection.json').read_text());monitor=current['monitor']
                if not (monitor['pointerDown'] or monitor['pendingSelection'] or monitor['selectionTimerActive']):break
                require(observed_attempt<2,'Readonly native selection did not settle; no native retry')
                require(self.remaining()>RESERVE+GRACE+.35,'No settle observation budget');time.sleep(.35)
        marker=self.scope_root/'slax-fixture.json';require(regular(marker).st_size<=1024,'Oversize synthetic marker')
        require(json.loads(marker.read_text())=={'controlledFixture':True,'fixtureVersion':1,'scenario':'reader-mixed','inputSha256':INPUT_SHA},'Different synthetic scope marker')
        dest=RUN/'snapshots'/name;dest.mkdir()
        for filename in ['slax-fixture.json','render-context.json','reader-position.json','reader-selection.json','reader-input.json','reader-lifecycle.json']:
            if filename=='reader-selection.json' and not selection:continue
            src=self.scope_root/filename;require(regular(src).st_size<=262144,'Bounded same-scope JSON exceeded')
            (dest/filename).write_bytes(src.read_bytes())
        self.write(dest/'controller.json',observed)
        pos=json.loads((dest/'reader-position.json').read_text());position(pos)
        require(pos['cacheKey']==observed['renderContext']['observedRoute']['params']['bookmarkId'],'Reader/cache identity differs')
        if self.live:
            require(pos['cacheKey']==self.live['cacheKey'] and pos['bridge']['pageId']==self.live['pageId'] and
                    pos['bridge']['nativeTag']==self.live['nativeTag'],'Live native Reader changed')
        return pos

    def native_result(self,phase):
        require(self.remaining()>=TEST+RESERVE+GRACE,'Insufficient native+release reserve')
        self.command(test_command(phase),TEST)
        info=RUN/(phase+'.xcresult')/'Info.plist';regular(info);plistlib.loads(info.read_bytes())
        summary=self.command([XCRUN,'xcresulttool','get','test-results','summary','--path',str(RUN/(phase+'.xcresult'))])
        exact_summary(json.loads(summary.read_text()),phase)
        tests=self.command([XCRUN,'xcresulttool','get','test-results','tests','--path',str(RUN/(phase+'.xcresult'))])
        exact_test_nodes(json.loads(tests.read_text()),phase)
        if phase == 'cross':
            self.receipt['crossActualInputStatus'] = 'observed-through-completed-native-selector'
            self.receipt['crossCompletedSelectorEvidence'] = {'summarySHA256': sha(summary), 'testsSHA256': sha(tests),
                                                              'selector': SELECTORS['cross']}
            self.save()
        self.command([XCRUN,'xcresulttool','export','attachments','--path',str(RUN/(phase+'.xcresult')),'--output-path',str(RUN/(phase+'-attachments'))])
        files=records(RUN/(phase+'.xcresult'));self.write(RUN/(phase+'-xcresult-manifest.json'),files)
        return {'summary':{'path':str(summary),'sha256':sha(summary)},'tests':{'path':str(tests),'sha256':sha(tests)},
                'manifestSHA256':sha(RUN/(phase+'-xcresult-manifest.json')),'attachments':records(RUN/(phase+'-attachments'))}

    def alpha(self):
        self.check_devices(self.command([XCRUN,'simctl','list','devices','--json']),True)
        metro=self.command([PS,'-p',str(METRO_PID),'-o','command='])
        cwd=self.command([LSOF,'-a','-p',str(METRO_PID),'-d','cwd','-Fn'])
        self.receipt['metroOwnerObservation'] = metro_ownership(metro.read_bytes(), cwd.read_bytes())
        verify_stage(); self.save()
        self.copy_products();self.boot=True
        self.command([XCRUN,'simctl','boot',DEVICE]);self.command([XCRUN,'simctl','bootstatus',DEVICE,'-b'],TEST)
        self.command([XCRUN,'simctl','status_bar',DEVICE,'override','--time','09:41'])
        self.command([XCRUN,'simctl','ui',DEVICE,'appearance','light']);self.command([XCRUN,'simctl','ui',DEVICE,'content_size','large'])
        self.check_devices(self.command([XCRUN,'simctl','list','devices','--json']),False)
        self.command([XCRUN,'simctl','openurl',DEVICE,LAUNCH_URL])
        ready=json.loads(self.command([NODE,str(READINESS),str(RUN)],READINESS_OUTER).read_text())
        require(ready['kind']=='bounded-read-only-fixture-inspector-ready' and ready['appId']==UI and ready['deviceName']==NAME and
                ready['websocketOpened'] is False and ready['expressionEvaluated'] is False and ready['fixtureActionIssued'] is False and
                type(ready['requestsIssued']) is int and 1<=ready['requestsIssued']<=80 and
                type(ready['elapsedMilliseconds']) in (int,float) and 0<=ready['elapsedMilliseconds']<=20000, 'Different readiness receipt')
        self.receipt['inspectorReadiness']=ready;self.save()
        prepared=json.loads(self.command(control_command('prepare'),PREPARE_OUTER).read_text());context(prepared)
        require(prepared['renderContext']['preparedActions']==[],'New scope was not initially empty')
        self.scope=prepared['scopeUri'];self.scope_root=scope_path(self.scope,Path(self.policy['installedUI']['dataRoot']))
        before=self.capture('before');snapshot=json.loads((RUN/'snapshots/before/reader-selection.json').read_text())
        require(snapshot['captured'] is None and snapshot['applicationSelection'] is None and
                (snapshot['monitor']['rangePresent'] is False or snapshot['monitor']['rangeCollapsed'] is True),'Selection existed before native input')
        self.live={'scopeUri':self.scope,'cacheKey':before['cacheKey'],'pageId':before['bridge']['pageId'],'nativeTag':before['bridge']['nativeTag'],
            'ownerPID':os.getpid(),'windowStartedUnixSeconds':self.started_unix,'alphaAllocationSHA256':self.receipt['alphaAllocationSHA256'],
            'alphaNonce':self.receipt['alphaNonce']}
        raw=self.native_result('alpha');self.capture('alpha')
        a=self.policy['installedUI'];helper=self.policy['alphaHelperMachOSHA256'];plist=self.policy['alphaXctestrunSHA256']
        report={'platform':'ios-simulator','identity':UI,'publisherBuild':False,'device':DEVICE,'scopeUri':self.scope,
            'stageMarkerSha256':STAGE_SHA,'inputSha256':INPUT_SHA,'installedExecutableSha256':a['executableSHA256'],
            'installedDebugDylibSha256':a['debugDylibSHA256'],'helperMachOSha256':helper,'xctestrunSha256':plist,
            'completedXcresultInfoPresent':True,'nativeTests':{'testName':SELECTORS['alpha'].split('/')[-1],'total':1,'passed':1,'failed':0,'skipped':0},
            'wrapper':{'exitCode':0,'refused':None},'actualInput':{'type':'native-XCTest','target':'unique-hittable-Alpha-StaticText',
            'pressSeconds':1,'pressCount':1,'domRangePrepared':False,'syntheticSelectionPublished':False},
            'status':'raw-fresh-alpha-awaiting-independent-native-frame-review','raw':raw}
        self.write(RUN/'alpha-report.json',report)
        self.write(RUN/'alpha-expected.json',{**{k:report[k] for k in ['device','scopeUri','inputSha256','stageMarkerSha256',
            'installedExecutableSha256','installedDebugDylibSha256','helperMachOSha256','xctestrunSha256']},'cacheKey':self.live['cacheKey']})
        self.command([NODE,str(HERE/'snapshot-check.mjs'),'alpha',str(RUN)])
        self.receipt['alphaRaw']=raw;self.receipt['live']=self.live;self.receipt['status']='awaiting-distinct-root-cross-grant'
        self.write(RUN/'handoff.json',{**self.live,'alphaReportSHA256':sha(RUN/'alpha-report.json'),
            'alphaSnapshotSHA256':sha(RUN/'snapshots/alpha/reader-selection.json'),'rawAlphaSummarySHA256':raw['summary']['sha256'],
            'rawAlphaXCResultManifestSHA256':raw['manifestSHA256'],'remainingSeconds':self.remaining(),
            'handoffEndsAtUnixSeconds':self.started_unix+TOTAL-TEST-RESERVE-GRACE})
        self.save()

    def cross(self):
        request=RUN/'cross-request.json'
        while not request.exists():
            remaining_for_cross(TOTAL-self.remaining());self.resources();time.sleep(.25)
        require(regular(request).st_size<=1024,'Oversize continuation request')
        submitted=json.loads(request.read_text());require(set(submitted)=={'crossAllocationSHA256'},'Unclosed submission')
        value=grant(GRANTS/'cross-allocation.json',submitted['crossAllocationSHA256'],'cross',self.policy)
        review=GRANTS/'alpha-independent-review.json';require(regular(review).st_size<=16384 and sha(review)==value['rootIndependentReviewSHA256'],'Independent review missing/changed')
        cross_barrier(value,self.live,json.loads((RUN/'alpha-report.json').read_text()),self.receipt['alphaRaw']['summary']['sha256'],
                      self.receipt['alphaRaw']['manifestSHA256'],json.loads(review.read_text()))
        verify_stage();verify_app(Path(self.policy['installedUI']['appRoot']),self.policy['installedUI']['files'])
        remaining_for_cross(TOTAL-self.remaining());self.capture('cross-before')
        self.command([NODE,str(HERE/'snapshot-check.mjs'),'alpha',str(RUN)])
        self.receipt['crossAllocationSHA256']=submitted['crossAllocationSHA256'];self.receipt['crossTestAuthorized']=True;self.save()
        raw=self.native_result('cross');self.receipt['crossRaw']=raw;self.save();self.capture('cross-after')
        self.command([NODE,str(HERE/'snapshot-check.mjs'),'cross',str(RUN)])
        self.receipt['crossPostInputScopeAccepted']=True;self.receipt['status']='raw-cross-result-awaiting-independent-native-review'

    def release(self):
        if self.boot:
            for argv,seconds in [*[( [XCRUN,'simctl','terminate',DEVICE,identity],2) for identity in sorted(HELPERS|{UI})],
                                 ([XCRUN,'simctl','status_bar',DEVICE,'clear'],3),([XCRUN,'simctl','shutdown',DEVICE],8)]:
                try:self.command(argv,seconds,True)
                except Exception as error:self.receipt.setdefault('releaseFailures',[]).append(str(error))
            try:self.check_devices(self.command([XCRUN,'simctl','list','devices','--json'],3,True),True);self.receipt['ownedShutdownReadback']=True
            except Exception as error:self.receipt.setdefault('releaseFailures',[]).append(str(error))

    def run(self):
        primary=None
        try:self.alpha();self.cross()
        except Exception as error:primary=type(error).__name__+': '+str(error);self.receipt['refusal']=primary
        finally:
            self.release()
            try:
                for source,entries in self.products.values():verify_records(source,entries)
                verify_stage();self.receipt['originalProductsAnd377StageUnchanged']=True
                verify_app(Path(self.policy['installedUI']['appRoot']),self.policy['installedUI']['files'])
                self.receipt['installed148UIAppFilesUnchanged']=True
                self.receipt['finalResources']=self.resources()
                self.receipt['installedHelperFinalManifests']=[{'path':e['path'],'identifier':e['identifier'],'files':records(Path(e['path']))}
                    for e in helper_accounting(self.baseline)['containers']]
            except Exception as error:self.receipt['finalGuardFailure']=str(error);primary=primary or str(error)
            self.receipt['elapsedSeconds']=TOTAL-self.remaining()
            if self.remaining()<0:primary=primary or 'Shared180second window exceeded'
            self.receipt['refusal']=primary;self.receipt['finished']=True
            if primary or self.receipt.get('releaseFailures'):self.receipt['status']='stopped-or-release-unconfirmed'
            try:self.save()
            except Exception as error:print(json.dumps({'finalReceiptWriteFailure':str(error),'originalRefusal':primary}))
        return 1 if primary or self.receipt.get('releaseFailures') else 0


def submit_cross(path,expected_sha):
    # This command only delivers a second reviewed grant. The original owner
    # alone owns the simulator commands and the global resource/deadline watch.
    policy=json.loads(POLICY.read_text());value=grant(path,expected_sha,'cross',policy)
    receipt=RUN/'receipt.json';require(regular(receipt).st_size<=1048576,'Bad owner receipt')
    state=json.loads(receipt.read_text());require(state['status']=='awaiting-distinct-root-cross-grant' and not state.get('finished'),'No live waiting owner')
    require(state['ownerPID']==value['ownerPID'] and state['windowStartedUnixSeconds']==value['windowStartedUnixSeconds'],'Wrong live owner')
    os.kill(state['ownerPID'],0);remaining_for_cross(time.time()-state['windowStartedUnixSeconds'])
    review=GRANTS/'alpha-independent-review.json';require(sha(review)==value['rootIndependentReviewSHA256'],'Changed Root review')
    cross_barrier(value,state['live'],json.loads((RUN/'alpha-report.json').read_text()),state['alphaRaw']['summary']['sha256'],
        state['alphaRaw']['manifestSHA256'],json.loads(review.read_text()))
    with (RUN/'cross-request.json').open('x') as output:output.write(json.dumps({'crossAllocationSHA256':expected_sha})+'\n')
    print(json.dumps({'status':'closed-cross-grant-submitted-owner-still-controls-window','nativeCommandExecutedBySubmission':False}))


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--alpha',action='store_true');parser.add_argument('--submit-cross',action='store_true')
    parser.add_argument('--allocation',type=Path);parser.add_argument('--allocation-sha256');args=parser.parse_args()
    require(not(args.alpha and args.submit_cross),'Select one phase')
    if args.submit_cross:
        require(args.allocation is not None and args.allocation_sha256 is not None,'Distinct Cross grant required')
        submit_cross(args.allocation,args.allocation_sha256);return 0
    plan,policy,products,baseline=admission()
    if not args.alpha:
        require(args.allocation is None and args.allocation_sha256 is None,'Readonly check takes no grant')
        print(json.dumps({'status':'readonly-preflight-pass','compiledAlphaFiles':63,'compiledCrossFiles':53,'stagedFiles':377,
            'existingHelperContainers':len([i for i in baseline.values() if i in HELPERS]),'nativeExecuted':False,'runRootCreated':False}));return 0
    value=grant(args.allocation,args.allocation_sha256,'alpha',policy)
    return Executor(policy,products,baseline,value,args.allocation_sha256).run()


if __name__=='__main__':
    try:raise SystemExit(main())
    except (ValueError,OSError,KeyError,TypeError,plistlib.InvalidFileException,json.JSONDecodeError) as error:
        print(json.dumps({'status':'refused-before-or-outside-owned-command','error':str(error)}));raise SystemExit(1)
