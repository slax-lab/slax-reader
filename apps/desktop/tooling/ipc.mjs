import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
const result = spawnSync(
  "cargo",
  ["run", "--quiet", "--locked", "-p", "slax-core", "--bin", "ipc-types"],
  {
    cwd: new URL("../", import.meta.url),
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  },
);
if (result.status !== 0) {
  process.stderr.write(result.stderr ?? "IPC generation failed");
  process.exit(result.status ?? 1);
}
const file = new URL("../src/ipc/generated.ts", import.meta.url);
if (process.argv.includes("--check")) {
  if ((await readFile(file, "utf8")) !== result.stdout)
    throw Error("IPC types changed. Run pnpm desktop -- ipc:generate.");
} else await writeFile(file, result.stdout);
