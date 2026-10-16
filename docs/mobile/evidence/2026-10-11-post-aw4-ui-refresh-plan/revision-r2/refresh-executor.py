#!/usr/bin/env python3
"""Prepared bounded fixture-only TS refresh; never build, start Metro or touch devices."""
from pathlib import Path
import argparse, hashlib, json, os, tempfile, time

REPO = Path(__file__).resolve().parents[5]
HERE = Path(__file__).resolve().parent
STAGE = Path('/private/var/folders/_l/80rthvqs2251jkn7spm33_s40000gn/T/slax-reader-ui-fixture-byWKU3')
BASE_MARKER_SHA = 'dee6cc6040c6574b621a2e49a791b8bf285fc4960ccdee3318df4ac4577dc801'
PLAN_SHA = '1469c5535815bc53accb93c146b9cf6b5e01cb2700345bd3d99f0ee44cb908b2'
CLOSURE_SHA = 'ca483ab30a8f6163dc0256aaa64d2cf6a920eb7f66426841b742a3614913d589'
NATIVE_RECEIPT_SHA = 'a930b22a732f8f514af9ecc7ad0158c6434f6c3c53fd1deb3500cc628684def9'
LIMIT_SECONDS = 60
MAX_WRITTEN_BYTES = 16 * 1024 * 1024
MIN_FREE_BYTES = 3 * 1024 * 1024 * 1024
began = time.monotonic()
written = 0


def check(condition, message):
    if not condition:
        raise RuntimeError(message)


def regular(p):
    check(p.is_file() and not p.is_symlink(), 'Expected regular public file: ' + str(p))
    check(all(not q.is_symlink() for q in p.parents), 'Symlink parent: ' + str(p))
    return p


def sha(p):
    h = hashlib.sha256()
    with regular(p).open('rb') as f:
        for block in iter(lambda: f.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def bound():
    check(time.monotonic() - began <= LIMIT_SECONDS, '60-second host refresh bound exceeded')
    check(written <= MAX_WRITTEN_BYTES, '16-MiB host output bound exceeded')
    stats = os.statvfs(STAGE)
    check(stats.f_bavail * stats.f_frsize >= MIN_FREE_BYTES, 'Root-reviewed3-GiB free-space floor not met')


def relative(p):
    check(not Path(p).is_absolute() and all(q not in ('', '.', '..') for q in p.split('/')), 'Unsafe relative path')
    check(not any(q.startswith('.env') or q in ('.dev.vars', 'credentials') for q in p.split('/')), 'Forbidden path')
    return p


def emit(p, data):
    global written
    bound()
    check(not p.exists(), 'Refuse overwrite: ' + str(p))
    p.parent.mkdir(parents=True, exist_ok=True)
    check(all(not q.is_symlink() for q in p.parents), 'Symlink output parent')
    written += len(data)
    bound()
    with p.open('xb') as f:
        f.write(data)


def atomic(p, data):
    global written
    bound()
    p.parent.mkdir(parents=True, exist_ok=True)
    check(all(not q.is_symlink() for q in p.parents), 'Symlink stage parent')
    check(not p.is_symlink(), 'Symlink stage target')
    written += len(data)
    bound()
    fd, temporary = tempfile.mkstemp(prefix='.slax-ts-refresh-', dir=p.parent)
    try:
        with os.fdopen(fd, 'wb') as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        os.replace(temporary, p)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def json_bytes(value):
    return (json.dumps(value, indent=2, ensure_ascii=False) + '\n').encode()


parser = argparse.ArgumentParser()
parser.add_argument('--mode', required=True, choices=['preflight', 'apply'])
parser.add_argument('--record-dir', required=True)
parser.add_argument('--allocation-file')
args = parser.parse_args()
record_dir = Path(args.record_dir).absolute()
check(not record_dir.exists() and not record_dir.is_symlink(), 'Require a new record directory')
check(record_dir.parent.resolve() == Path('/private/tmp') and record_dir.name.startswith('slax-ui-ts-refresh-'), 'Require exact owned temporary output namespace')
check(REPO.name == 'slax-reader' and (REPO / 'apps/mobile').is_dir(), 'Incorrect repository ancestry')
check(sha(HERE / 'plan.json') == PLAN_SHA and sha(HERE / 'proposed-closure.json') == CLOSURE_SHA, 'Prepared immutable plan/closure mismatch')
plan = json.loads((HERE / 'plan.json').read_text())
closure = json.loads((HERE / 'proposed-closure.json').read_text())
marker_path = STAGE / '.slax-ui-fixture-project.json'
check(sha(marker_path) == BASE_MARKER_SHA, 'The native aw4 stage changed; new reviewed plan required')
marker = json.loads(marker_path.read_text())
check(marker['kind'] == 'slax-ui-fixture-project' and marker['iosId'] == 'app.slax.reader.uifixture', 'Wrong isolated fixture identity')
check(marker['projectRoot'] == str(STAGE) or Path(marker['projectRoot']).resolve() == STAGE, 'Wrong marker owner')
check(len(marker['generatedSourceDigests']) == 372, 'Different base source closure')
for item in marker['generatedSourceDigests']:
    check(sha(STAGE / relative(item['path'])) == item['sha256'], 'Base generated input changed: ' + item['path'])
items = closure['productInputs']
check(len(items) == 120, 'Different product closure')
current_paths = {str(p.relative_to(REPO / 'apps/mobile')) for p in (REPO / 'apps/mobile/src').rglob('*') if p.is_file()}
check(current_paths == {i['path'] for i in items if i['path'].startswith('src/')}, 'New or removed production source input')
changed = []
for item in items:
    rel = relative(item['path'])
    current = REPO / 'apps/mobile' / rel
    archive = REPO / relative(item['archive'])
    check(sha(current) == sha(archive) == item['currentSha256'], 'Current/archive input changed: ' + rel)
    native_stage = STAGE / rel
    actual_stage = sha(native_stage) if native_stage.is_file() else None
    check(actual_stage == item['stageSha256'], 'Base product input changed: ' + rel)
    check((item['currentSha256'] != actual_stage) == item['wouldRefresh'], 'Delta declaration inconsistent')
    if item['wouldRefresh']:
        check(rel.startswith('src/'), 'Only the twelve declared src TS deltas may change')
        changed.append(item)
check(len(changed) == 12 and sum(i['stageSha256'] is None for i in changed) == 5, 'Require twelve deltas/five new files')
for item in closure['mandatoryDataInputs']:
    check(sha(REPO / relative(item['path'])) == item['sha256'], 'DATA current input changed')
    old = item['authorArchive']
    check(sha(REPO / relative(old['path'])) == old['sha256'] == item['sha256'], 'DATA archive mismatch')
for item in closure['iosNativeComparison']:
    check(sha(REPO / 'apps/mobile' / relative(item['path'])) == item['currentSha256'], 'Current native audit input changed')
    p = STAGE / relative(item['path'])
    check((sha(p) if p.is_file() else None) == item['compiledStageSha256'], 'Compiled native input changed')
for item in closure['publicStagePodInputs']:
    check(sha(Path(item['path'])) == item['sha256'], 'Pod input changed')
for name in ('dependencies', 'devDependencies', 'peerDependencies'):
    current = json.loads((REPO / 'apps/mobile/package.json').read_text()).get(name)
    frozen = json.loads((STAGE / 'package.json').read_text()).get(name)
    check(current == frozen, 'Dependency declaration changed')
for receipt in plan['dataReviewBindings'].values():
    if isinstance(receipt, dict) and 'path' in receipt:
        check(sha(REPO / relative(receipt['path'])) == receipt['sha256'], 'DATA review receipt changed')
native_receipt = REPO / 'docs/mobile/evidence/2026-10-11-reader-native-source-bridge/aw4-completed-signed-app/report.json'
check(sha(native_receipt) == NATIVE_RECEIPT_SHA, 'Signed native receipt changed')
bound()

if args.mode == 'apply':
    check(args.allocation_file is not None, 'Root allocation is required for apply')
    allocation_path = regular(Path(args.allocation_file).absolute())
    check(allocation_path.is_relative_to(REPO / 'docs/mobile/evidence'), 'Allocation must be an explicit local evidence receipt')
    allocation = json.loads(allocation_path.read_text())
    expected = {'kind': 'slax-root-ui-ts-refresh-allocation', 'stageRoot': str(STAGE), 'baseMarkerSha256': BASE_MARKER_SHA, 'planSha256': PLAN_SHA, 'closureSha256': CLOSURE_SHA, 'executorSha256': sha(Path(__file__)), 'nativeReceiptSha256': NATIVE_RECEIPT_SHA, 'readerWindowReleased': True, 'rootHostAndHermesWindowComplete': True, 'googleProbeWindowComplete': True, 'stageAndMetroOwnedFrozen': True, 'allowNativeBuild': False, 'allowMetroCommand': False, 'allowDeviceCommand': False}
    check(all(allocation.get(k) == v for k, v in expected.items()), 'Allocation is absent/stale or allows operations outside this executor')
    emit(record_dir / 'allocation.json', allocation_path.read_bytes())

emit(record_dir / 'owner.json', json_bytes({'kind': 'slax-owned-ui-ts-refresh-host-records', 'version': 1, 'stageRoot': str(STAGE), 'baseMarkerSha256': BASE_MARKER_SHA, 'executorSha256': sha(Path(__file__)), 'mode': args.mode, 'noDeviceMetroOrNativeCommands': True}))
emit(record_dir / 'base-marker.json', marker_path.read_bytes())
for item in changed:
    p = STAGE / item['path']
    if p.exists():
        emit(record_dir / 'before' / item['path'], p.read_bytes())
report = {'kind': 'slax-bounded-ui-ts-refresh', 'mode': args.mode, 'planSha256': PLAN_SHA, 'closureSha256': CLOSURE_SHA, 'baseMarkerSha256': BASE_MARKER_SHA, 'deltas': changed, 'generatedBefore': 372, 'deviceCalls': False, 'metroCommands': False, 'nativeBuild': False, 'status': 'readonly-preflight-passed-stage-unchanged'}
if args.mode == 'apply':
    try:
        for item in changed:
            atomic(STAGE / item['path'], (REPO / item['archive']).read_bytes())
            check(sha(STAGE / item['path']) == item['currentSha256'], 'Copy verification failed')
        delta_map = {i['path']: i['currentSha256'] for i in changed}
        for field in ('sourceFileDigests', 'generatedSourceDigests'):
            mapping = {i['path']: i['sha256'] for i in marker[field]}
            mapping.update(delta_map)
            marker[field] = [{'path': p, 'sha256': s} for p, s in sorted(mapping.items())]
        marker['inputRevision'] = 'post-aw4-pure-ts-gallery-feed-drawer-rss-final-data-r2'
        for item in marker['generatedSourceDigests']:
            check(sha(STAGE / item['path']) == item['sha256'], 'Post-refresh generated hash failed')
        check(len(marker['generatedSourceDigests']) == 377, 'Unexpected post-refresh closure')
        atomic(marker_path, json_bytes(marker))
        report.update(status='twelve-declared-ts-deltas-refreshed-stage-frozen-no-runtime-execution', currentMarkerSha256=sha(marker_path), generatedAfter=377)
        emit(record_dir / 'current-marker.json', marker_path.read_bytes())
    except BaseException:
        report['status'] = 'failed-partial-stage-must-not-run-until-new-root-review'
        report['actualDeltaDigests'] = {i['path']: sha(STAGE / i['path']) if (STAGE / i['path']).is_file() else None for i in changed}
        try:
            emit(record_dir / 'failure.json', json_bytes(report))
        except BaseException:
            # A failed space/time guard must still leave a bounded public failure
            # record in the caller's captured stdout; never resume stage writes.
            print(json.dumps(report))
        raise
report['elapsedSeconds'] = time.monotonic() - began
report['hostBytesWritten'] = written
emit(record_dir / 'report.json', json_bytes(report))
print(json.dumps({'status': report['status'], 'recordDirectory': str(record_dir), 'stageMutated': args.mode == 'apply'}))
