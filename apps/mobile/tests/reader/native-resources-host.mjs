import {mkdtempSync, readdirSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve, delimiter} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

// Supply public compiler artifacts already installed by the native build.
// No dependency fetch, Gradle init script or application secrets; synthetic HTTP stays on loopback.
const compiler = process.env.SLAX_KOTLIN_COMPILER_CLASSPATH;
const stdlib = process.env.SLAX_KOTLIN_STDLIB;
const network = process.env.SLAX_OKHTTP_CLASSPATH;
if (!network) throw new Error('Set SLAX_OKHTTP_CLASSPATH to the existing React Native OkHttp and Okio public jars.');
const libraries = [stdlib, network].join(delimiter);
if (!compiler || !stdlib) throw new Error('Set SLAX_KOTLIN_COMPILER_CLASSPATH and SLAX_KOTLIN_STDLIB to public Kotlin compiler/library jars.');
const java = process.env.JAVA_HOME ? resolve(process.env.JAVA_HOME, 'bin/java') : 'java';
const source = fileURLToPath(new URL('../../modules/slax-platform/android/src/main/java/com/slax/reader/platform/SlaxResources.kt', import.meta.url));
const directory = fileURLToPath(new URL('./native-resources-host/', import.meta.url));
const temporary = mkdtempSync(resolve(tmpdir(), 'slax-resources-compiler-'));
function run(args) {
  const result = spawnSync(java, args, {stdio: 'inherit', timeout: 120000});
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Kotlin resource fixture exited with ${result.status}`);
}
try {
  const output = resolve(temporary, 'classes');
  run(['-Xmx512m', '-cp', compiler, 'org.jetbrains.kotlin.cli.jvm.K2JVMCompiler', '-no-stdlib', '-no-reflect', '-classpath', libraries, '-d', output, source, source.replace('SlaxResources.kt', 'SlaxCachePathsModule.kt'), source.replace('SlaxResources.kt', 'SlaxReaderSecurity.kt'), source.replace('SlaxResources.kt', 'SlaxReaderImages.kt'), ...readdirSync(directory).filter(name => name.endsWith('.kt')).map(name => resolve(directory, name))]);
  run(['-cp', [output, libraries].join(delimiter), 'com.slax.reader.platform.HostKt']);
  if (process.platform === 'darwin') {
    const swiftSource = fileURLToPath(new URL('../../modules/slax-platform/ios/SlaxResourceHandler.swift', import.meta.url));
    const executable = resolve(temporary, 'swift-resources');
    for (const [command, args] of [
      ['xcrun', ['swiftc', '-swift-version', '5', '-emit-module', '-emit-library', '-module-name', 'ExpoModulesCore', resolve(directory, 'ExpoModulesCore.swift'), '-o', resolve(temporary, 'libExpoModulesCore.dylib')]],
      ['xcrun', ['swiftc', '-swift-version', '5', '-D', 'DEBUG', '-I', temporary, '-L', temporary, '-lExpoModulesCore', '-Xlinker', '-rpath', '-Xlinker', temporary, swiftSource, swiftSource.replace('SlaxResourceHandler.swift', 'SlaxCachePathsModule.swift'), swiftSource.replace('SlaxResourceHandler.swift', 'SlaxReaderSecurity.swift'), swiftSource.replace('SlaxResourceHandler.swift', 'SlaxReaderImages.swift'), resolve(directory, 'ImageOwner.swift'), resolve(directory, 'Host.swift'), '-o', executable]],
      ['python3', [resolve(directory, 'media-server.py'), executable]],
    ]) {
      const result = spawnSync(command, args, {stdio: 'inherit', timeout: 120000});
      if (result.error) throw result.error;
      if (result.status !== 0) throw new Error(`Swift resource fixture exited with ${result.status}`);
    }
  }
} finally {rmSync(temporary, {recursive: true, force: true});}
