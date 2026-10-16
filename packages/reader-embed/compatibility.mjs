import {readFile} from 'node:fs/promises';
import {dirname, relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const source = fileURLToPath(new URL('./src/', import.meta.url));
const modules = new Set(['pdf-geometry.ts', 'pdf-errors.ts', 'pdf-types.ts', 'types.ts', 'input.ts',
  ...['annotations', 'layout', 'marks', 'pages', 'selection', 'transport', 'types'].map(name => `pdf/runtime/${name}.ts`)]);

/** Preserve the existing bundler module identities and order for byte-stable host builds. */
export function readerCompatibilityPlugin(legacyRoot) {
  return {name: 'reader-embed-compatibility', setup(build) {
    build.onLoad({filter: /\.ts$/}, async ({path}) => {
      const key = relative(legacyRoot, path).replaceAll('\\', '/');
      if (!modules.has(key)) return;
      return {contents: await readFile(resolve(source, key), 'utf8'), loader: 'ts', resolveDir: dirname(path)};
    });
  }};
}
