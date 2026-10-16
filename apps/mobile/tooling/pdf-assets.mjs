import {build, transform} from 'esbuild';
import {readerCompatibilityPlugin} from '../../../packages/reader-embed/compatibility.mjs';
import {createRequire} from 'node:module';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {mkdir, readdir, readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

const require = createRequire(import.meta.url);
const mobile = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const root = dirname(require.resolve('pdfjs-dist/package.json'));
const version = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version;
if (version !== '6.4.299') throw new Error(`Review PDF.js asset integration before upgrading ${version}`);
const output = join(mobile, 'assets/pdf');
await mkdir(output, {recursive: true});
const resources = {};
const licenses = {};
for (const directory of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
  for (const filename of (await readdir(join(root, directory))).sort()) {
    const bytes = await readFile(join(root, directory, filename));
    if (/LICENSE|COPYING/i.test(filename)) licenses[`${directory}/${filename}`] = bytes.toString('utf8');
    else resources[`${directory}/${filename}`] = bytes.toString('base64');
  }
}
licenses.LICENSE = await readFile(join(root, 'LICENSE'), 'utf8');
let worker = await readFile(join(root, 'legacy/build/pdf.worker.mjs'), 'utf8');
function replaceOnce(source, before, after) {
  if (source.split(before).length !== 2) throw new Error(`PDF.js resource hook changed: ${before}`);
  return source.replace(before, after);
}
worker = replaceOnce(worker, 'function fetchSync(url) {', 'function fetchSync(url) { return globalThis.__slaxPdfResourceBytes(url).buffer;');
worker = replaceOnce(worker, '`${WasmImage.#wasmUrl}${this._noWasmFilename}`);', 'globalThis.__slaxPdfResourceModule(`${WasmImage.#wasmUrl}${this._noWasmFilename}`));');
const workerResources = Object.fromEntries(Object.entries(resources).filter(([key]) => key.startsWith('iccs/') || key === 'wasm/qcms_bg.wasm' || key.endsWith('_fallback.js')));
const resourceHook = `const resources=${JSON.stringify(workerResources)};
const decode=value=>Uint8Array.from(atob(value), c=>c.charCodeAt(0));
const key=url=>{if(typeof url!=='string'||!url.startsWith('slax-pdf-resource:'))throw Error('Blocked PDF resource');const k=url.slice(18);if(!Object.hasOwn(resources,k))throw Error('Unknown PDF resource');return k};
globalThis.__slaxPdfResourceBytes=url=>decode(resources[key(url)]);
const modules=new Map();globalThis.__slaxPdfResourceModule=url=>{const k=key(url);if(!k.endsWith('_fallback.js'))throw Error('Blocked module');if(!modules.has(k))modules.set(k,URL.createObjectURL(new Blob([decode(resources[k])],{type:'text/javascript'})));return modules.get(k)};`;
const workerBundle = await transform(resourceHook + worker, {minify: true, format: 'esm', target: ['safari16.4', 'chrome110'], legalComments: 'inline'});
const viewer = await build({plugins: [readerCompatibilityPlugin(join(mobile, 'src/reader'))], entryPoints: [join(mobile, 'src/reader/pdf-runtime.ts')], bundle: true, write: false,
  format: 'iife', platform: 'browser', target: ['safari16.4', 'chrome110'], minify: true, legalComments: 'inline'});
const asset = {version, script: viewer.outputFiles[0].text, worker: workerBundle.code, resources};
const json = JSON.stringify(asset);
await writeFile(join(output, 'bundle.json'), json);
await writeFile(join(output, 'LICENSES.txt'), Object.entries(licenses).map(([name, text]) => `===== ${name} =====\n${text}`).join('\n\n'));
await writeFile(join(output, 'manifest.json'), JSON.stringify({version, sha256: createHash('sha256').update(json).digest('hex'),
  resources: Object.keys(resources), worker: 'legacy/build/pdf.worker.mjs', api: 'legacy/build/pdf.mjs'}, null, 2) + '\n');
console.log(`PDF.js ${version}: bundled viewer, real module worker and ${Object.keys(resources).length} local resources (${json.length} bytes)`);
