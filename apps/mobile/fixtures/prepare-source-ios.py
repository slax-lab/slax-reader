"""Stage the original iOS Compose UI from closed public inputs, without production configuration."""
import argparse
from hashlib import sha256
import importlib.util
import json
from pathlib import Path
import shutil

FIXTURES = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('source_fixture_android_preparer', FIXTURES / 'prepare-source.py')
android = importlib.util.module_from_spec(spec)
spec.loader.exec_module(android)
IOS_OVERLAYS = ['FixturePlatform.kt', 'FixtureGoogle.kt', 'FixturePreferences.kt', 'FixturePolicy.kt', 'SourceFixture.kt', 'FixtureWebViewHost.kt']
EXCLUDED_IOS = ['MainViewController.kt', 'FirebaseHelper.ios.kt', 'IapHelper.ios.kt', 'ShareHelper.ios.kt', 'GoogleSignIn.ios.kt', 'PreferencesDataStore.ios.kt', 'WebViewHelper.ios.kt']

def replace_exact(content, old, new, count=1):
    if content.count(old) != count:
        raise ValueError(f'Pinned adapter transformation no longer matches: {old[:100]}')
    return content.replace(old, new)

def reader_adapter(content):
    for line in ['import android.content.Context\n', 'import android.content.res.AssetManager\n', 'import android.util.Base64\n', 'import java.io.File\n', 'import java.security.MessageDigest\n', 'import dev.jordond.connectivity.Connectivity\n']:
        content = replace_exact(content, line, '')
    content = replace_exact(content, '    context: Context,\n    assets: AssetManager,', '    loadAsset: (String) -> ByteArray,')
    content = replace_exact(content, '    @Volatile private var webState:', '    private var webState:')
    content = replace_exact(content, '    private val readinessLock = Any()\n', '')
    content = content.replace('synchronized(readinessLock)', 'run').replace('return@synchronized', 'return@run')
    content = content.replace('System.nanoTime()', '(platform.Foundation.NSProcessInfo.processInfo.systemUptime * 1_000_000_000).toLong()')
    content = replace_exact(content, '            put("fixtureImageRequestCount", FixtureReaderResources.requestCount)\n', '')
    start = content.index('            // Read only the concrete source connectivity provider\'s replay.')
    end = content.index('            put("expectedUserId"', start)
    # JVM reflection is only a rejection diagnostic. The original Native
    # coordinator remains intact; absence of this extra replay is explicit.
    content = content[:start] + '            put("concreteNetworkReplay", "not-exposed-by-native-adapter")\n' + content[end:]
    content = replace_exact(content, '    private val fixtureHttp = FixtureReaderHttp(payload)', '    private val fixtureHttp = FixtureReaderHttp(payload)\n    val httpClient get() = fixtureHttp.client')
    start = content.index('    init {\n        check(context.packageName')
    end = content.index('\n    @Composable fun Render', start)
    controlled_init = r'''    init {
        check(platform.Foundation.NSBundle.mainBundle.bundleIdentifier == "app.slax.reader.sourcefixture")
        check(files.deleteDataDirectory("bookmark"))
        val resourceSource = loadAsset("resources.ts").decodeToString()
        val base64 = Regex("fixtureArtworkBase64\\s*=\\s*\"([A-Za-z0-9+/=]+)\"").find(resourceSource)?.groupValues?.get(1)
            ?: error("Prepared source fixture artwork is missing")
        val artwork = kotlin.io.encoding.Base64.decode(base64)
        val imageUrls = Regex("\"(https://fixture-images\\.test/[^\"]+)\"\\s*:").findAll(resourceSource).map {it.groupValues[1]}.toList()
        payload.getValue("cache").jsonArray.forEach { item ->
            val record = item.jsonObject
            val key = record.getValue("key").jsonPrimitive.content
            val htmlFile = record.getValue("htmlFile").jsonPrimitive.content
            check(key.matches(Regex("[A-Za-z0-9_-]+")) && htmlFile.matches(Regex("articles/[a-z-]+\\.html")))
            files.writeDataFile("bookmark/$key/content.html", loadAsset(htmlFile))
            imageUrls.filterNot {it.contains("/failure.png")}.forEach {url -> imageDownloadManager.cacheData(url, key, artwork)}
        }
    }
'''
    content = content[:start] + controlled_init + content[end:]
    return '@file:OptIn(kotlin.io.encoding.ExperimentalEncodingApi::class, kotlinx.cinterop.ExperimentalForeignApi::class)\n' + content

def prepare(source, output):
    marker = android.prepare(source, output)
    output = output.resolve()
    original_manifest = json.loads((android.REPOSITORY / 'docs/mobile/source-manifest.json').read_text())
    pinned = {entry['path'] for entry in original_manifest['files']}
    kotlin = output / 'composeApp/src/fixtureIosMain/kotlin/com/slax/reader/fixtures'
    kotlin.mkdir(parents=True)
    for name in IOS_OVERLAYS:
        shutil.copyfile(FIXTURES / 'source-ios' / name, kotlin / name)
    for name in ['FixturePayload.kt', 'FixtureReaderHttp.kt']:
        shutil.copyfile(FIXTURES / 'source-android' / name, kotlin / name)
    (kotlin / 'SourceReaderAdapter.kt').write_text(reader_adapter((FIXTURES / 'source-android/SourceReaderAdapter.kt').read_text()))
    original_web = output / 'composeApp/src/iosMain/kotlin/com/slax/reader/utils/WebViewHelper.ios.kt'
    controlled_web = replace_exact(original_web.read_text(), 'val userContentController = WKUserContentController()',
        'val userContentController = WKUserContentController().apply { addContentRuleList(com.slax.reader.fixtures.fixtureWebRules()) }', 2)
    controlled_web = replace_exact(controlled_web, 'SFSafariViewController(uRL = NSURL(string = url))', 'com.slax.reader.fixtures.fixtureBlockedSafari(url)', 2)
    (kotlin / 'FixtureOriginalWebView.kt').write_text(controlled_web)
    interop = output / 'composeApp/src/fixtureIosMain/cinterop'
    interop.mkdir()
    for name in ['FixtureFoundation.h', 'fixture-foundation.def']:
        shutil.copyfile(FIXTURES / 'source-ios' / name, interop / name)
    for name, destination in [('build.gradle.kts', 'build.gradle.kts'), ('settings.gradle.kts', 'settings.gradle.kts'), ('composeApp.gradle.kts', 'composeApp/build.gradle.kts')]:
        shutil.copyfile(FIXTURES / 'source-ios' / name, output / destination)
    (output / 'gradle.properties').write_text('org.gradle.jvmargs=-Xmx1536m -Dfile.encoding=UTF-8\norg.gradle.workers.max=1\nkotlin.compiler.execution.strategy=in-process\nkotlin.code.style=official\n')
    harness = output / 'ios-harness'
    harness.mkdir()
    for name in ['Info.plist', 'main.swift', 'FixtureReaderStep.swift']:
        shutil.copyfile(FIXTURES / 'source-ios' / name, harness / name)
    shutil.copytree(output / 'composeApp/src/androidInstrumentedTest/assets/slax-ui-fixtures', harness / 'slax-ui-fixtures')
    shutil.copyfile(FIXTURES / 'source-ios/README.md', output / 'SOURCE-HARNESS.md')
    # Keep the copied pinned files intact even when a platform factory is not compiled.
    for entry in original_manifest['files']:
        if sha256((output / entry['path']).read_bytes()).hexdigest() != entry['sha256']:
            raise ValueError(f'Original public file was modified during staging: {entry["path"]}')
    marker.update({'sourceIosAdapter': 'written-not-compiled-or-run', 'platform': 'ios-simulator-arm64',
        'sourceNativeBuild': 'sanitized-ios-template-written-not-built', 'androidAdapter': 'not-built-in-this-stage',
        'sourceReaderAdapter': 'written-not-compiled-or-run', 'bundleIdentifier': 'app.slax.reader.sourcefixture',
        'excludedIosPlatformFactories': EXCLUDED_IOS,
        'platformDifferences': ['memory DataStore instead of production App Group', 'synthetic provider callbacks; no Firebase/StoreKit/share SDK',
            'original WKWebView helper plus two precompiled network-rule additions and explicit external Safari rejection', 'direct initial route with original UIKit/Compose controller; native navigation input pending',
            'sanitized Objective-C KVO protocol interop supplies original platform.foundation namespace; compiler opts in to ExperimentalForeignApi',
            'optional bounded Swift driver posts only original top/anchor bridge events after initial readonly observations; no direct scroll injection or native gesture claim',
            'Reader primes the concrete shared user/subscription DAO values from a preceding Library lifecycle', 'remote legal documents replaced with the same shared local fixture pages']})
    capture_path = harness / 'slax-ui-fixtures/source-capture-inputs.json'
    marker['overlayDigests'] = [{'path': str(path.relative_to(output)), 'sha256': sha256(path.read_bytes()).hexdigest()}
        for path in sorted(output.rglob('*')) if path.is_file() and str(path.relative_to(output)) not in pinned
        and path.name != 'slax-source-fixture.json' and path != capture_path]
    capture = {key: marker[key] for key in ['sourceCommit', 'sourceManifestSha256', 'fixtureInputSha256']}
    capture['actionDriverSha256'] = sha256(json.dumps(marker['overlayDigests'], sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    capture_path.write_text(json.dumps(capture, indent=2) + '\n')
    marker['overlayDigests'].append({'path': str(capture_path.relative_to(output)), 'sha256': sha256(capture_path.read_bytes()).hexdigest()})
    (output / 'slax-source-fixture.json').write_text(json.dumps(marker, indent=2) + '\n')
    return marker

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(prepare(args.source, args.output), indent=2))
