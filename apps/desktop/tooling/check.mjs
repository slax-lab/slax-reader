import { spawnSync } from "node:child_process";
const root = new URL("../", import.meta.url);
for (const [program, args] of [
  ["cargo", ["fmt", "--all", "--check"]],
  [
    "cargo",
    [
      "clippy",
      "--workspace",
      "--all-targets",
      "--locked",
      "--",
      "-D",
      "warnings",
    ],
  ],
  ["cargo", ["test", "--locked", "-p", "slax-core"]],
  ["pnpm", ["run", "ipc:check"]],
  ["pnpm", ["run", "typecheck"]],
  ["pnpm", ["run", "test"]],
  ["pnpm", ["run", "frontend:build"]],
]) {
  const result = spawnSync(program, args, { cwd: root, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
