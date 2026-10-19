import { build, transform } from "esbuild";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
const require = createRequire(import.meta.url),
  app = dirname(dirname(fileURLToPath(import.meta.url)));
const root = dirname(require.resolve("pdfjs-dist/package.json")),
  generated = join(app, "reader-frame/generated");
const version = JSON.parse(
  await readFile(join(root, "package.json"), "utf8"),
).version;
if (version !== "6.4.299")
  throw Error("Review the PDF runtime before upgrading PDF.js");
await mkdir(generated, { recursive: true });
const resources = {},
  licenses = { LICENSE: await readFile(join(root, "LICENSE"), "utf8") };
for (const directory of ["cmaps", "standard_fonts", "wasm", "iccs"])
  for (const file of (await readdir(join(root, directory))).sort()) {
    const bytes = await readFile(join(root, directory, file));
    if (/LICENSE|COPYING/i.test(file))
      licenses[`${directory}/${file}`] = bytes.toString("utf8");
    else resources[`${directory}/${file}`] = bytes.toString("base64");
  }
function replaceOnce(source, before, after) {
  if (source.split(before).length !== 2)
    throw Error(`PDF resource contract changed: ${before}`);
  return source.replace(before, after);
}
let worker = await readFile(join(root, "legacy/build/pdf.worker.mjs"), "utf8");
worker = replaceOnce(
  worker,
  "function fetchSync(url) {",
  "function fetchSync(url) { return globalThis.__slaxPdfResourceBytes(url).buffer;",
);
worker = replaceOnce(
  worker,
  "`${WasmImage.#wasmUrl}${this._noWasmFilename}`);",
  "globalThis.__slaxPdfResourceModule(`${WasmImage.#wasmUrl}${this._noWasmFilename}`));",
);
const workerResources = Object.fromEntries(
  Object.entries(resources).filter(
    ([key]) =>
      key.startsWith("iccs/") ||
      key === "wasm/qcms_bg.wasm" ||
      key.endsWith("_fallback.js"),
  ),
);
const hook = `const resources=${JSON.stringify(workerResources)};const decode=v=>Uint8Array.from(atob(v),c=>c.charCodeAt(0));const key=u=>{if(typeof u!=='string'||!u.startsWith('slax-pdf-resource:'))throw Error('PDF_RESOURCE_DENIED');const k=u.slice(18);if(!Object.hasOwn(resources,k))throw Error('PDF_RESOURCE_DENIED');return k};globalThis.__slaxPdfResourceBytes=u=>decode(resources[key(u)]);const modules=new Map();globalThis.__slaxPdfResourceModule=u=>{const k=key(u);if(!k.endsWith('_fallback.js'))throw Error('PDF_RESOURCE_DENIED');if(!modules.has(k))modules.set(k,URL.createObjectURL(new Blob([decode(resources[k])],{type:'text/javascript'})));return modules.get(k)};`;
const transformed = await transform(hook + worker, {
  minify: true,
  format: "esm",
  target: "safari17",
  legalComments: "inline",
});
const viewer = await build({
  entryPoints: [join(app, "reader-frame/pdf-runtime.ts")],
  bundle: true,
  write: false,
  format: "iife",
  platform: "browser",
  target: "safari17",
  minify: true,
  legalComments: "inline",
});
await writeFile(join(generated, "pdf-runtime.js"), viewer.outputFiles[0].text);
await writeFile(
  join(generated, "pdf-assets.json"),
  JSON.stringify({ version, worker: transformed.code, resources }),
);
await writeFile(
  join(generated, "LICENSES.txt"),
  Object.entries(licenses)
    .map(([name, text]) => `===== ${name} =====\n${text}`)
    .join("\n\n"),
);
