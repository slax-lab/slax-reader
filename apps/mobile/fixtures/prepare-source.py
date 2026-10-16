"""Stage only pinned public source/resources and the isolated source Android capture adapter."""
import argparse
from fnmatch import fnmatch
from hashlib import sha256
import json
from pathlib import Path
import re
import shutil
import tempfile
from base64 import b64encode

FIXTURES = Path(__file__).resolve().parent
REPOSITORY = FIXTURES.parents[2]
DENIED_NAME = re.compile(r"(^\.env(?:\.|$)|^\.dev\.vars(?:\.|$)|credential|secret|private.?key|keystore|GoogleService|google-services)", re.I)
LEGACY_OVERLAY_FILES = {
    'SOURCE-HARNESS.md', 'build.gradle.kts', 'composeApp/build.gradle.kts',
    'settings.gradle.kts', 'gradle.properties',
    'composeApp/src/androidMain/AndroidManifest.xml',
    'composeApp/src/commonMain/kotlin/app/slax/reader/SlaxConfig.kt',
    *('composeApp/src/fixtureMain/kotlin/' + name for name in ['FixtureFirebase.kt', 'SourceFixtureActivity.kt']),
    *('composeApp/src/fixtureInstrumentedTest/kotlin/com/slax/reader/fixtures/' + name for name in
      ['FixtureRunner.kt', 'FixturePayload.kt', 'FixtureWebViewHost.kt', 'FixtureReaderHttp.kt', 'SourceReaderAdapter.kt', 'SourceReferenceFixtureTest.kt']),
    *('composeApp/src/androidInstrumentedTest/assets/slax-ui-fixtures/' + name for name in
      ['manifest.json', 'scenarios.json', 'documents.ts', 'resources.ts', 'source-capture-inputs.json',
       'articles/delete-notice.html', 'articles/long.html', 'articles/mixed.html', 'articles/privacy.html',
       'articles/rss.html', 'articles/short.html', 'articles/terms.html', 'articles/video.html']),
}
OVERLAY_FILES = LEGACY_OVERLAY_FILES | {
    'composeApp/src/fixtureMain/kotlin/FixtureReaderResources.kt',
    'composeApp/src/fixtureMain/kotlin/FixtureWebViewHelper.android.kt',
}
READER_HELPER = 'composeApp/src/androidMain/kotlin/com/slax/reader/utils/WebviewHelper.android.kt'
READER_INTERCEPT_ANCHOR = '''                        val url = request?.url?.toString() ?: return null

                        if (!url.startsWith("slaxstatics://") && !url.startsWith("slaxstatic://")) {'''
READER_INTERCEPT_INSERTION = '''                        com.slax.reader.fixtures.FixtureReaderResources.intercept(request)?.let { return it }
'''


def reader_resource_helper(content):
    text = content.decode('utf-8')
    if text.count(READER_INTERCEPT_ANCHOR) != 1:
        raise ValueError('Pinned Android reader resource hook no longer matches exactly')
    return text.replace(READER_INTERCEPT_ANCHOR, READER_INTERCEPT_INSERTION + READER_INTERCEPT_ANCHOR, 1).encode('utf-8')


def safe_relative(raw, patterns):
    path = Path(raw)
    if path.is_absolute() or '..' in path.parts or any(DENIED_NAME.search(part) for part in path.parts):
        raise ValueError(f'Forbidden source manifest path: {raw}')
    if not any(fnmatch(raw, pattern) for pattern in patterns):
        raise ValueError(f'Outside the source whitelist: {raw}')
    return path


def snapshot_inputs(snapshot, manifest, manifest_hash):
    evidence_root = (REPOSITORY / 'docs/mobile/evidence').resolve(strict=True)
    original = snapshot.absolute()
    snapshot = snapshot.resolve(strict=True)
    if evidence_root not in snapshot.parents or not snapshot.is_dir():
        raise ValueError('Overlay replay requires an archived input directory under docs/mobile/evidence')
    for candidate in [original, *original.parents]:
        if candidate.is_symlink():
            raise ValueError('Archived overlay directory cannot follow symlinks')
        if candidate == evidence_root:
            break
    def archived_file(relative):
        path = snapshot / relative
        for candidate in [path, *path.parents]:
            if candidate.is_symlink():
                raise ValueError(f'Archived overlay cannot follow symlinks: {relative}')
            if candidate == snapshot:
                break
        if not path.is_file() or snapshot not in path.resolve(strict=True).parents:
            raise ValueError(f'Missing archived overlay: {relative}')
        return path.read_bytes()
    marker = json.loads(archived_file('input-manifest.json'))
    if (marker.get('controlledFixture') is not True or marker.get('fixtureVersion') != 1
            or marker.get('sourceCommit') != manifest['sourceCommit']
            or marker.get('sourceManifestSha256') != manifest_hash
            or marker.get('copiedPinnedFiles') != len(manifest['files'])
            or marker.get('sourceCheckoutModified') is not False
            or marker.get('originalBuildConfigurationCopied') is not False):
        raise ValueError('Archived overlay does not match the pinned isolated source baseline')
    entries = marker['overlayDigests']
    paths = {entry['path'] for entry in entries}
    if len(entries) != len(paths) or paths not in (LEGACY_OVERLAY_FILES, OVERLAY_FILES):
        raise ValueError('Archived overlay must contain the exact closed capture input set')
    records = []
    for entry in entries:
        relative = safe_relative(entry['path'], OVERLAY_FILES)
        content = archived_file(relative)
        if sha256(content).hexdigest() != entry['sha256']:
            raise ValueError(f'Archived overlay checksum mismatch: {relative}')
        records.append((relative, content))
    by_path = {str(relative): content for relative, content in records}
    if paths == OVERLAY_FILES:
        resource = marker.get('androidReaderResourceInterception', {})
        controlled_path = 'composeApp/src/fixtureMain/kotlin/FixtureWebViewHelper.android.kt'
        original_hash = next(entry['sha256'] for entry in manifest['files'] if entry['path'] == READER_HELPER)
        controlled = by_path[controlled_path]
        insertion = READER_INTERCEPT_INSERTION.encode('utf-8')
        if (resource.get('originalHelperPath') != READER_HELPER or resource.get('originalHelperSha256') != original_hash
                or resource.get('controlledHelperPath') != controlled_path
                or resource.get('controlledHelperSha256') != sha256(controlled).hexdigest()
                or resource.get('exactInsertion') != READER_INTERCEPT_INSERTION
                or controlled.count(insertion) != 1
                or sha256(controlled.replace(insertion, b'', 1)).hexdigest() != original_hash
                or resource.get('declaredHttpsImagesOnly') is not True
                or resource.get('otherHttpRequestsDeniedLocally') is not True
                or resource.get('internetPermissionAdded') is not False):
            raise ValueError('Archived reader resource derivative differs from the pinned original helper')
    asset_root = 'composeApp/src/androidInstrumentedTest/assets/slax-ui-fixtures/'
    fixture_manifest = json.loads(by_path[asset_root + 'manifest.json'])
    for entry in fixture_manifest['files']:
        relative = safe_relative(entry['path'], ['scenarios.json', 'articles/*.html', 'documents.ts', 'resources.ts'])
        if sha256(by_path[asset_root + str(relative)]).hexdigest() != entry['sha256']:
            raise ValueError(f'Archived fixture checksum mismatch: {relative}')
    fixture_hash = sha256(by_path[asset_root + 'scenarios.json']).hexdigest()
    capture_inputs = json.loads(by_path[asset_root + 'source-capture-inputs.json'])
    driver_entries = [entry for entry in entries if entry['path'] != asset_root + 'source-capture-inputs.json']
    driver_hash = sha256(json.dumps(driver_entries, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    if marker.get('fixtureInputSha256') != fixture_hash or capture_inputs != {
            'sourceCommit': manifest['sourceCommit'], 'sourceManifestSha256': manifest_hash,
            'fixtureInputSha256': fixture_hash, 'actionDriverSha256': driver_hash}:
        raise ValueError('Archived fixture/driver identity is inconsistent')
    return marker, records


def prepare(source, output, overlay_snapshot=None):
    source = source.resolve(strict=True)
    output = output.resolve()
    temporary_roots = [Path('/tmp').resolve(), Path(tempfile.gettempdir()).resolve()]
    if not any(root in output.parents for root in temporary_roots) or not re.fullmatch(r'slax-source-ui-fixture-[a-z0-9-]+', output.name):
        raise ValueError('Output must be a new slax-source-ui-fixture-* directory inside a temporary root')
    if output.exists() or source == output or source in output.parents or REPOSITORY.resolve() in output.parents:
        raise ValueError('Output must be new and separate from both repositories')
    manifest_path = REPOSITORY / 'docs/mobile/source-manifest.json'
    manifest = json.loads(manifest_path.read_text())
    if manifest['inputPolicy']['strategy'] != 'closed path-and-extension whitelist':
        raise ValueError('Expected a closed source whitelist')
    archived = snapshot_inputs(overlay_snapshot, manifest, sha256(manifest_path.read_bytes()).hexdigest()) if overlay_snapshot else None
    records = []
    for entry in manifest['files']:
        relative = safe_relative(entry['path'], manifest['inputPolicy']['includedPatterns'])
        candidate = source / relative
        if candidate.is_symlink() or source not in candidate.resolve(strict=True).parents:
            raise ValueError(f'Source symlinks are not fixture inputs: {relative}')
        content = candidate.read_bytes()
        digest = sha256(content).hexdigest()
        if digest != entry['sha256'] or len(content) != entry['bytes']:
            raise ValueError(f'Pinned source changed: {relative}; refresh the reviewed baseline first')
        records.append((relative, content))
    output.mkdir()
    for relative, content in records:
        destination = output / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(content)
    if archived:
        marker, overlay_records = archived
        for relative, content in overlay_records:
            destination = output / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(content)
        (output / 'slax-source-fixture.json').write_text(json.dumps(marker, indent=2) + '\n')
        return marker
    overlay = output / 'composeApp/src/fixtureInstrumentedTest/kotlin/com/slax/reader/fixtures'
    overlay.mkdir(parents=True)
    for name in ['FixtureRunner.kt', 'FixturePayload.kt', 'FixtureWebViewHost.kt', 'FixtureReaderHttp.kt', 'SourceReaderAdapter.kt', 'SourceReferenceFixtureTest.kt']:
        shutil.copyfile(FIXTURES / 'source-android' / name, overlay / name)
    main_overlay = output / 'composeApp/src/fixtureMain/kotlin'
    main_overlay.mkdir(parents=True)
    for name in ['FixtureFirebase.kt', 'SourceFixtureActivity.kt', 'FixtureReaderResources.kt']:
        shutil.copyfile(FIXTURES / 'source-android' / name, main_overlay / name)
    original_helper = output / READER_HELPER
    original_helper_bytes = original_helper.read_bytes()
    controlled_helper = reader_resource_helper(original_helper_bytes)
    (main_overlay / 'FixtureWebViewHelper.android.kt').write_bytes(controlled_helper)
    for source_name, destination_name in [('settings.gradle.kts', 'settings.gradle.kts'),
                                           ('build.gradle.kts', 'build.gradle.kts'),
                                           ('composeApp.gradle.kts', 'composeApp/build.gradle.kts')]:
        shutil.copyfile(FIXTURES / 'source-android' / source_name, output / destination_name)
    (output / 'gradle.properties').write_text('org.gradle.jvmargs=-Xmx2g -Dfile.encoding=UTF-8\norg.gradle.workers.max=2\nkotlin.compiler.execution.strategy=in-process\nandroid.useAndroidX=true\nkotlin.code.style=official\n')
    assets = output / 'composeApp/src/androidInstrumentedTest/assets/slax-ui-fixtures'
    assets.mkdir(parents=True)
    fixture_manifest = json.loads((FIXTURES / 'manifest.json').read_text())
    for entry in fixture_manifest['files']:
        relative = safe_relative(entry['path'], ['scenarios.json', 'articles/*.html', 'documents.ts', 'resources.ts'])
        content = (FIXTURES / relative).read_bytes()
        if sha256(content).hexdigest() != entry['sha256']:
            raise ValueError(f'Fixture input changed: {relative}')
        destination = assets / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(content)
    shutil.copyfile(FIXTURES / 'manifest.json', assets / 'manifest.json')
    android = output / 'composeApp/src/androidMain/AndroidManifest.xml'
    shutil.copyfile(FIXTURES / 'source-android/FixtureManifest.xml', android)
    generated = output / 'composeApp/src/commonMain/kotlin/app/slax/reader/SlaxConfig.kt'
    generated.parent.mkdir(parents=True)
    def read_embedded(relative):
        original = output / 'public/embedded' / relative
        minimum = original.with_name(original.stem + '.min' + original.suffix)
        return (minimum if minimum.is_file() else original).read_text()
    template = read_embedded('html/webview-template.html')
    for placeholder, relative in [('RESET-CSS', 'css/reset.css'), ('ARTICLE-CSS', 'css/article.css'),
                                   ('MARK-CSS', 'css/mark.css'), ('BOTTOM-LINE-CSS', 'css/bottom-line.css'),
                                   ('WEBVIEW-BRIGDE-JS', 'js/webview-bridge.js')]:
        template = template.replace('{{' + placeholder + '}}', read_embedded(relative))
    policy = "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src slaxstatic: slaxstatics: data: blob: https://fixture-images.test; media-src data: blob:; connect-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'\">"
    template = template.replace('<head>', '<head>' + policy, 1)
    error_document = read_embedded('html/error.html').replace('{{BACKGROUND}}', b64encode((output / 'public/embedded/image/error.png').read_bytes()).decode('ascii'))
    def kotlin_document(name, document):
        encoded = b64encode(document.encode()).decode('ascii')
        chunks = ',\n        '.join('"' + encoded[index:index + 8192] + '"' for index in range(0, len(encoded), 8192))
        return f'    val {name}: String = kotlin.io.encoding.Base64.decode(listOf(\n        {chunks}\n    ).joinToString("")).decodeToString()\n'
    generated.write_text('''package app.slax.reader

/** Isolated capture constants composed only from checksum-verified source resources. */
@OptIn(kotlin.io.encoding.ExperimentalEncodingApi::class)
object SlaxConfig {
    const val API_BASE_URL = "https://fixture-api.test"
    const val API_BETA_URL = "https://fixture-api-beta.test"
    const val WEB_BASE_URL = "https://fixture-pages.test"
    const val WEB_DOMAIN = ".test"
    const val APP_VERSION_NAME = "fixture"
    const val APP_VERSION_CODE = 1
    const val BUILD_ENV = "fixture"
    const val GOOGLE_AUTH_SERVER_ID = ""
    const val LOCAL_POWERSYNC_URL = ""
''' + kotlin_document('WEBVIEW_TEMPLATE', template) + kotlin_document('DETAIL_ERROR_TEMPLATE', error_document) + '}\n')
    shutil.copyfile(FIXTURES / 'source-android/README.md', output / 'SOURCE-HARNESS.md')
    marker = {'controlledFixture': True, 'fixtureVersion': 1, 'sourceCommit': manifest['sourceCommit'],
              'sourceManifestSha256': sha256(manifest_path.read_bytes()).hexdigest(), 'copiedPinnedFiles': len(records),
              'fixtureInputSha256': next(item['sha256'] for item in fixture_manifest['files'] if item['path'] == 'scenarios.json'),
              'sourceCheckoutModified': False, 'originalBuildConfigurationCopied': False,
              'androidAdapter': 'written-not-compiled-or-run', 'sourceReaderAdapter': 'written-not-compiled-or-run', 'sourceIosAdapter': 'pending',
              'sourceNativeBuild': 'sanitized-template-written-not-built', 'nativeVisualAcceptance': 'unverified'}
    marker['androidReaderResourceInterception'] = {
        'originalHelperPath': READER_HELPER,
        'originalHelperSha256': sha256(original_helper_bytes).hexdigest(),
        'controlledHelperPath': 'composeApp/src/fixtureMain/kotlin/FixtureWebViewHelper.android.kt',
        'controlledHelperSha256': sha256(controlled_helper).hexdigest(),
        'exactInsertion': READER_INTERCEPT_INSERTION,
        'declaredHttpsImagesOnly': True,
        'otherHttpRequestsDeniedLocally': True,
        'internetPermissionAdded': False,
        'nativeResourceExecution': 'pending',
    }
    marker['overlayDigests'] = [{ 'path': str(path.relative_to(output)), 'sha256': sha256(path.read_bytes()).hexdigest() }
                               for path in sorted(output.rglob('*')) if path.is_file() and str(path.relative_to(output)) not in {str(relative) for relative, _ in records}]
    capture_inputs = {key: marker[key] for key in ['sourceCommit', 'sourceManifestSha256', 'fixtureInputSha256']}
    capture_inputs['actionDriverSha256'] = sha256(json.dumps(marker['overlayDigests'], sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    capture_inputs_path = assets / 'source-capture-inputs.json'
    capture_inputs_path.write_text(json.dumps(capture_inputs, indent=2) + '\n')
    marker['overlayDigests'].append({'path': str(capture_inputs_path.relative_to(output)), 'sha256': sha256(capture_inputs_path.read_bytes()).hexdigest()})
    (output / 'slax-source-fixture.json').write_text(json.dumps(marker, indent=2) + '\n')
    return marker


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--overlay-snapshot', type=Path, help='Replay the exact reviewed archived inputs instead of current overlays/fixtures')
    args = parser.parse_args()
    try:
        marker = prepare(args.source, args.output, args.overlay_snapshot)
    except (ValueError, OSError, KeyError) as error:
        parser.exit(1, f'Source fixture preparation failed: {error}\n')
    print(json.dumps({'output': str(args.output.resolve()), **{key: value for key, value in marker.items() if key != 'overlayDigests'}, 'overlayFiles': len(marker['overlayDigests'])}, indent=2))
