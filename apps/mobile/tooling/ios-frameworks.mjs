import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {existsSync, readdirSync, realpathSync} from 'node:fs';
import path from 'node:path';

export function requiredDylibs(output) {
  return output.split(/Load command \d+/).flatMap(command => {
    if (!/\bcmd LC_(?:LOAD|REEXPORT|LOAD_UPWARD)_DYLIB\b/.test(command)) return [];
    const name = /^\s*name (.+) \(offset \d+\)/m.exec(command)?.[1];
    return name ? [name] : [];
  });
}

export function verifyFrameworkClosure(application, inspect = binary => execFileSync('otool', ['-l', binary], {encoding: 'utf8', maxBuffer: 8 * 1024 * 1024})) {
  const root = realpathSync(application), binaries = [];
  const visit = directory => {
    const infoPath = path.join(directory, 'Info.plist');
    if (existsSync(infoPath)) {
      const info = JSON.parse(execFileSync('plutil', ['-convert', 'json', '-o', '-', infoPath], {encoding: 'utf8'}));
      if (info.CFBundleExecutable) {
        assert(/^[\w.-]+$/.test(info.CFBundleExecutable), 'Unexpected bundle executable');
        const binary = path.join(directory, info.CFBundleExecutable);
        assert(existsSync(binary), `Missing bundle executable: ${path.relative(root, binary)}`);
        binaries.push(binary);
      }
    }
    for (const subdirectory of ['Frameworks', 'PlugIns']) {
      const container = path.join(directory, subdirectory);
      if (!existsSync(container)) continue;
      for (const entry of readdirSync(container, {withFileTypes: true})) {
        if (entry.isDirectory() && /\.(framework|appex)$/.test(entry.name)) visit(path.join(container, entry.name));
        else if (entry.isFile() && entry.name.endsWith('.dylib')) binaries.push(path.join(container, entry.name));
      }
    }
  };
  visit(root);
  assert(binaries.length > 0, 'No bundle executables found');
  for (const binary of binaries) {
    for (const dependency of requiredDylibs(inspect(binary))) {
      if (dependency.startsWith('/System/Library/') || dependency.startsWith('/usr/lib/') || /^@rpath\/libswift[^/]+\.dylib$/.test(dependency)) continue;
      const loader = path.dirname(binary);
      const candidates = dependency.startsWith('@rpath/')
        ? [path.join(root, 'Frameworks', dependency.slice(7)), path.join(loader, 'Frameworks', dependency.slice(7)), path.join(loader, '..', dependency.slice(7))]
        : dependency.startsWith('@loader_path/') ? [path.resolve(loader, dependency.slice(13))]
        : dependency.startsWith('@executable_path/') ? [path.resolve(root, dependency.slice(17))] : [];
      assert(candidates.some(candidate => candidate.startsWith(`${root}${path.sep}`) && existsSync(candidate)),
        `Missing embedded dependency ${dependency} required by ${path.relative(root, binary)}`);
    }
  }
  return {executablesChecked: binaries.length};
}
