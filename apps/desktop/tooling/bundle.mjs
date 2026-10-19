import { spawnSync } from "node:child_process";
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  selectEnvironment,
  buildEnvironment,
  tauriConfiguration,
} from "./environment.mjs";
const app = dirname(dirname(fileURLToPath(import.meta.url)));
const { profile, forwarded: args } = selectEnvironment(process.argv.slice(2));
if (args.some((value) => !["--host", "--debug"].includes(value)))
  throw Error(
    "Usage: pnpm desktop -- bundle --env local|preview|beta|main [--host] [--debug]",
  );
const target = args.includes("--host") ? undefined : "universal-apple-darwin";
const debug = args.includes("--debug");
const directory = join(app, ".artifacts");
const configPath = join(directory, `bundle-${profile.environment}.json`);
console.log(
  `Desktop ${profile.environment}: API ${profile.apiOrigin}; Web ${profile.webOrigin}`,
);
await mkdir(directory, { recursive: true });
const icon = spawnSync(
  "pnpm",
  [
    "exec",
    "tauri",
    "icon",
    "../mobile/assets/app-icon.png",
    "--output",
    "src-tauri/icons",
  ],
  { cwd: app, stdio: "inherit" },
);
if (icon.status !== 0) process.exit(icon.status ?? 1);
await writeFile(
  configPath,
  JSON.stringify({
    ...tauriConfiguration(profile),
    bundle: {
      icon: ["icons/icon.icns", "icons/icon.png"],
      ...(process.env.SLAX_DESKTOP_MINIMUM_MACOS
        ? {
            macOS: {
              minimumSystemVersion: process.env.SLAX_DESKTOP_MINIMUM_MACOS,
            },
          }
        : {}),
    },
  }),
);
const config = [
  "build",
  "--config",
  configPath,
  "--bundles",
  "app",
  ...(target ? ["--target", target] : []),
  ...(debug ? ["--debug"] : []),
];
const result = spawnSync("pnpm", ["exec", "tauri", ...config], {
  cwd: app,
  stdio: "inherit",
  env: buildEnvironment(profile),
});
if (result.status !== 0) process.exit(result.status ?? 1);
const bundle = join(
  app,
  "target",
  ...(target ? [target] : []),
  debug ? "debug" : "release",
  "bundle",
  "macos",
  `${profile.productName}.app`,
);
const architecture = spawnSync(
  "lipo",
  ["-archs", join(bundle, "Contents/MacOS/slax-reader-desktop")],
  { encoding: "utf8" },
);
if (architecture.status !== 0)
  throw Error("Could not inspect the bundled executable architecture");
const architectures = architecture.stdout.trim().split(/\s+/).sort();
if (
  target &&
  JSON.stringify(architectures) !== JSON.stringify(["arm64", "x86_64"])
)
  throw Error("Universal package must contain both arm64 and x86_64");
const files = [];
async function walk(root, prefix = "") {
  for (const entry of (await readdir(root, { withFileTypes: true })).sort(
    (a, b) => a.name.localeCompare(b.name),
  )) {
    const relative = prefix + entry.name,
      path = join(root, entry.name);
    if (entry.isDirectory()) await walk(path, relative + "/");
    else if (entry.isFile()) {
      const bytes = await readFile(path);
      files.push({
        path: relative,
        size: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      });
    }
  }
}
await walk(bundle);
const manifest = {
  product: "slax-reader-desktop",
  version: JSON.parse(await readFile(join(app, "package.json"), "utf8"))
    .version,
  ...profile,
  architectures,
  signed: false,
  bundle,
  files,
};
await writeFile(
  join(directory, `manifest-${profile.environment}.json`),
  JSON.stringify(manifest, null, 2) + "\n",
);
console.log(`Built ${bundle}`);
