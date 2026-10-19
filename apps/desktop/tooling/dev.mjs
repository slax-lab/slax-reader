import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  selectEnvironment,
  buildEnvironment,
  tauriConfiguration,
} from "./environment.mjs";

const { profile, forwarded } = selectEnvironment(process.argv.slice(2));
const config = new URL(
  `../.artifacts/dev-${profile.environment}.json`,
  import.meta.url,
);
await mkdir(new URL("../.artifacts/", import.meta.url), { recursive: true });
await writeFile(config, JSON.stringify(tauriConfiguration(profile)));
console.log(
  `Desktop ${profile.environment}: API ${profile.apiOrigin}; Web ${profile.webOrigin}`,
);
const child = spawn(
  "pnpm",
  ["exec", "tauri", "dev", "--config", fileURLToPath(config), ...forwarded],
  {
    cwd: new URL("../", import.meta.url),
    env: buildEnvironment(profile),
    stdio: "inherit",
  },
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => child.kill(signal));
child.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on("close", (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
