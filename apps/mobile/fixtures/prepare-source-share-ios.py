"""Stage a simulator-only original Swift Share presentation with an explicit UI boundary stub."""
import argparse
from hashlib import sha256
import json
from pathlib import Path
import shutil
import tempfile

ROOT = Path(__file__).resolve().parents[3]
TEMPLATE = Path(__file__).resolve().parent / 'source-share-ios'


def project_text():
    objects = {}

    def add(name, value):
        identity = sha256(('source-share-fixture:' + name).encode()).hexdigest()[:24].upper()
        if identity in objects:
            raise ValueError('Duplicate isolated project object')
        objects[identity] = value
        return identity

    def ref(name):
        return sha256(('source-share-fixture:' + name).encode()).hexdigest()[:24].upper()

    def config(name, settings):
        entry = add(name + '-debug', {'isa': 'XCBuildConfiguration', 'name': 'Debug', 'buildSettings': settings})
        return add(name + '-configs', {'isa': 'XCConfigurationList', 'buildConfigurations': [entry], 'defaultConfigurationName': 'Debug', 'defaultConfigurationIsVisible': 0})

    def dependency(target):
        proxy = add(target + '-proxy', {'isa': 'PBXContainerItemProxy', 'containerPortal': ref('project'), 'proxyType': 1, 'remoteGlobalIDString': ref(target), 'remoteInfo': target})
        return add(target + '-dependency', {'isa': 'PBXTargetDependency', 'target': ref(target), 'targetProxy': proxy})

    products = {}
    sources = []
    for target, product, kind in [('ComposeApp', 'ComposeApp.framework', 'wrapper.framework'), ('SourceShareExtension', 'SourceShareExtension.appex', 'wrapper.app-extension'), ('SourceShareHost', 'SourceShareHost.app', 'wrapper.application')]:
        products[target] = add(target + '-product', {'isa': 'PBXFileReference', 'explicitFileType': kind, 'path': product, 'sourceTree': 'BUILT_PRODUCTS_DIR', 'includeInIndex': 0})
    for target, source, settings in [
        ('ComposeApp', 'ComposeAppStub.swift', {'PRODUCT_BUNDLE_IDENTIFIER': 'app.slax.reader.sourcesharefixture.boundary', 'PRODUCT_NAME': 'ComposeApp', 'DEFINES_MODULE': 'YES', 'GENERATE_INFOPLIST_FILE': 'YES', 'SKIP_INSTALL': 'YES', 'DYLIB_INSTALL_NAME_BASE': '@rpath'}),
        ('SourceShareExtension', 'original/ShareViewController.swift', {'PRODUCT_BUNDLE_IDENTIFIER': 'app.slax.reader.sourcesharefixture.share', 'PRODUCT_NAME': 'SourceShareExtension', 'INFOPLIST_FILE': 'ShareInfo.plist', 'APPLICATION_EXTENSION_API_ONLY': 'YES', 'SKIP_INSTALL': 'YES', 'FRAMEWORK_SEARCH_PATHS': '$(inherited) $(BUILT_PRODUCTS_DIR)', 'LD_RUNPATH_SEARCH_PATHS': '$(inherited) @executable_path/Frameworks @executable_path/../../Frameworks'}),
        ('SourceShareHost', 'Host.swift', {'PRODUCT_BUNDLE_IDENTIFIER': 'app.slax.reader.sourcesharefixture', 'PRODUCT_NAME': 'SourceShareHost', 'GENERATE_INFOPLIST_FILE': 'YES', 'INFOPLIST_KEY_CFBundleDisplayName': 'Source Share UI Fixture', 'INFOPLIST_KEY_UILaunchScreen_Generation': 'YES'}),
    ]:
        source_ref = add(target + '-source', {'isa': 'PBXFileReference', 'lastKnownFileType': 'sourcecode.swift', 'path': source, 'sourceTree': '<group>'})
        sources.append(source_ref)
        build_ref = add(target + '-source-build', {'isa': 'PBXBuildFile', 'fileRef': source_ref})
        phases = [add(target + '-sources', {'isa': 'PBXSourcesBuildPhase', 'buildActionMask': 2147483647, 'files': [build_ref], 'runOnlyForDeploymentPostprocessing': 0})]
        dependencies = []
        if target == 'SourceShareExtension':
            dependencies.append(dependency('ComposeApp'))
            linked = add('boundary-link', {'isa': 'PBXBuildFile', 'fileRef': products['ComposeApp']})
            phases.append(add('extension-frameworks', {'isa': 'PBXFrameworksBuildPhase', 'buildActionMask': 2147483647, 'files': [linked], 'runOnlyForDeploymentPostprocessing': 0}))
            embedded = add('boundary-embed', {'isa': 'PBXBuildFile', 'fileRef': products['ComposeApp'], 'settings': {'ATTRIBUTES': ['CodeSignOnCopy', 'RemoveHeadersOnCopy']}})
            phases.append(add('extension-embed', {'isa': 'PBXCopyFilesBuildPhase', 'name': 'Embed UI-only boundary', 'buildActionMask': 2147483647, 'dstPath': '', 'dstSubfolderSpec': 10, 'files': [embedded], 'runOnlyForDeploymentPostprocessing': 0}))
        if target == 'SourceShareHost':
            dependencies.append(dependency('SourceShareExtension'))
            embedded = add('extension-embed-build', {'isa': 'PBXBuildFile', 'fileRef': products['SourceShareExtension'], 'settings': {'ATTRIBUTES': ['CodeSignOnCopy', 'RemoveHeadersOnCopy']}})
            phases.append(add('host-embed', {'isa': 'PBXCopyFilesBuildPhase', 'name': 'Embed original Share UI', 'buildActionMask': 2147483647, 'dstPath': '', 'dstSubfolderSpec': 13, 'files': [embedded], 'runOnlyForDeploymentPostprocessing': 0}))
        product_type = {'ComposeApp': 'com.apple.product-type.framework', 'SourceShareExtension': 'com.apple.product-type.app-extension', 'SourceShareHost': 'com.apple.product-type.application'}[target]
        add(target, {'isa': 'PBXNativeTarget', 'name': target, 'productName': target, 'productReference': products[target], 'productType': product_type, 'buildConfigurationList': config(target, settings), 'buildPhases': phases, 'buildRules': [], 'dependencies': dependencies})
    product_group = add('products', {'isa': 'PBXGroup', 'name': 'Products', 'sourceTree': '<group>', 'children': list(products.values())})
    main_group = add('main-group', {'isa': 'PBXGroup', 'sourceTree': '<group>', 'children': sources + [product_group]})
    project_config = config('project', {'SDKROOT': 'iphonesimulator', 'SUPPORTED_PLATFORMS': 'iphonesimulator', 'IPHONEOS_DEPLOYMENT_TARGET': '16.4', 'SWIFT_VERSION': '5.0', 'ARCHS': 'arm64', 'ONLY_ACTIVE_ARCH': 'YES', 'CLANG_ENABLE_MODULES': 'YES', 'TARGETED_DEVICE_FAMILY': '1,2', 'CODE_SIGNING_ALLOWED': 'NO'})
    add('project', {'isa': 'PBXProject', 'attributes': {'LastUpgradeCheck': '2600'}, 'buildConfigurationList': project_config, 'compatibilityVersion': 'Xcode 14.0', 'developmentRegion': 'en', 'knownRegions': ['en', 'Base'], 'mainGroup': main_group, 'productRefGroup': product_group, 'projectDirPath': '', 'projectRoot': '', 'targets': [ref(name) for name in products]})

    def render(value):
        if isinstance(value, dict):
            return '{' + ''.join(json.dumps(str(key)) + '=' + render(item) + ';' for key, item in value.items()) + '}'
        if isinstance(value, list):
            return '(' + ','.join(render(item) for item in value) + ')'
        return json.dumps(value)
    return '// !$*UTF8*$!\n' + render({'archiveVersion': 1, 'classes': {}, 'objectVersion': 56, 'objects': objects, 'rootObject': ref('project')}) + '\n'


def prepare(source, output):
    source = source.resolve()
    output = output.absolute()
    temporary_roots = {Path('/tmp').resolve(), Path(tempfile.gettempdir()).resolve()}
    if output.exists() or output.parent.resolve() not in temporary_roots or not output.name.startswith('slax-source-share-fixture-'):
        raise ValueError('A fresh controlled temporary Share fixture directory is required')
    manifest_path = ROOT / 'docs/mobile/source-manifest.json'
    manifest = json.loads(manifest_path.read_text())
    relative = 'iosApp/share/ShareViewController.swift'
    record = next(entry for entry in manifest['files'] if entry['path'] == relative)
    original = source / relative
    if original.resolve() != original or not original.is_file() or sha256(original.read_bytes()).hexdigest() != record['sha256']:
        raise ValueError('The original public Share controller differs from the pinned whitelist')
    output.mkdir()
    (output / 'original').mkdir()
    shutil.copyfile(original, output / 'original/ShareViewController.swift')
    for name in ['ComposeAppStub.swift', 'Host.swift', 'ShareInfo.plist', 'README.md']:
        shutil.copyfile(TEMPLATE / name, output / name)
    project = output / 'SourceShareFixture.xcodeproj'
    project.mkdir()
    (project / 'project.pbxproj').write_text(project_text())
    schemes = project / 'xcshareddata/xcschemes'
    schemes.mkdir(parents=True)
    host = sha256(b'source-share-fixture:SourceShareHost').hexdigest()[:24].upper()
    reference = f'<BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="{host}" BuildableName="SourceShareHost.app" BlueprintName="SourceShareHost" ReferencedContainer="container:SourceShareFixture.xcodeproj"/>'
    (schemes / 'SourceShareFixture.xcscheme').write_text(f'''<?xml version="1.0" encoding="UTF-8"?>
<Scheme LastUpgradeVersion="2600" version="1.3">
<BuildAction parallelizeBuildables="NO" buildImplicitDependencies="YES"><BuildActionEntries><BuildActionEntry buildForTesting="NO" buildForRunning="YES" buildForProfiling="NO" buildForArchiving="NO" buildForAnalyzing="YES">{reference}</BuildActionEntry></BuildActionEntries></BuildAction>
<LaunchAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB"><BuildableProductRunnable runnableDebuggingMode="0">{reference}</BuildableProductRunnable></LaunchAction>
</Scheme>\n''')
    marker = {'controlledFixture': True, 'fixtureVersion': 1, 'kind': 'original-swift-share-presentation', 'simulatorOnly': True,
        'bundleIdentifier': 'app.slax.reader.sourcesharefixture', 'extensionIdentifier': 'app.slax.reader.sourcesharefixture.share',
        'sourceCommit': manifest['sourceCommit'], 'sourceManifestSha256': sha256(manifest_path.read_bytes()).hexdigest(),
        'originalSourcePath': relative, 'originalSourceSha256': record['sha256'], 'sourceCheckoutModified': False,
        'originalSwiftByteIdentical': True, 'originalKotlinRuntime': False, 'realNetwork': False, 'productionAppGroup': False,
        'syntheticBoundary': 'explicit-local-ComposeApp.ShareKt-Swift-stub', 'nativeVisualAcceptance': 'unverified',
        'files': [{'path': str(p.relative_to(output)), 'sha256': sha256(p.read_bytes()).hexdigest()} for p in sorted(output.rglob('*')) if p.is_file()]}
    (output / 'source-share-fixture.json').write_text(json.dumps(marker, indent=2) + '\n')
    return marker


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(prepare(args.source, args.output), indent=2))
