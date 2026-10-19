import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, basename } from "node:path";
import { createHash } from "node:crypto";
import { selectEnvironment } from "./environment.mjs";
const { profile, forwarded: args } = selectEnvironment(process.argv.slice(2));
const value = (name) => {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
};
const stage = args[0],
  channel = profile.channel,
  bundle = value("--app");
if (
  !["sign", "notarize", "prepare-update"].includes(stage) ||
  !bundle ||
  profile.environment === "local"
)
  throw Error(
    "Usage: pnpm desktop -- release sign|notarize|prepare-update --env preview|beta|main --app /absolute/App.app; local builds cannot be released",
  );
const required = [
  "SLAX_DESKTOP_MINIMUM_MACOS",
  "SLAX_DESKTOP_DISTRIBUTION_APPROVED",
  "SLAX_DESKTOP_SIGNING_IDENTITY",
  "SLAX_DESKTOP_NOTARY_PROFILE",
];
if (
  required.some((name) => !process.env[name]) ||
  process.env.SLAX_DESKTOP_DISTRIBUTION_APPROVED !== "true"
)
  throw Error(
    "Release is inactive. Supply approved minimum macOS, distribution decision, Developer ID identity, and Keychain notary profile.",
  );
const run = (program, options) => {
  const r = spawnSync(program, options, { stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
};
const app = resolve(bundle);
const expected = profile.identifier;
const identity = spawnSync(
  "/usr/libexec/PlistBuddy",
  ["-c", "Print :CFBundleIdentifier", `${app}/Contents/Info.plist`],
  { encoding: "utf8" },
);
if (identity.status !== 0 || identity.stdout.trim() !== expected)
  throw Error("Bundle identity does not match the requested channel");
const minimum = spawnSync(
  "/usr/libexec/PlistBuddy",
  ["-c", "Print :LSMinimumSystemVersion", `${app}/Contents/Info.plist`],
  { encoding: "utf8" },
);
if (minimum.stdout?.trim() !== process.env.SLAX_DESKTOP_MINIMUM_MACOS)
  throw Error("Rebuild with the approved minimum macOS before signing");
if (stage === "sign") {
  run("codesign", [
    "--force",
    "--options",
    "runtime",
    "--timestamp",
    "--sign",
    process.env.SLAX_DESKTOP_SIGNING_IDENTITY,
    "--entitlements",
    resolve("src-tauri/Entitlements.plist"),
    app,
  ]);
  run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", app]);
} else if (stage === "notarize") {
  const zip = `${app}.notary.zip`;
  run("ditto", ["-c", "-k", "--keepParent", app, zip]);
  run("xcrun", [
    "notarytool",
    "submit",
    zip,
    "--keychain-profile",
    process.env.SLAX_DESKTOP_NOTARY_PROFILE,
    "--wait",
  ]);
  run("xcrun", ["stapler", "staple", app]);
  run("spctl", ["--assess", "--type", "execute", "--verbose=2", app]);
} else {
  const endpoint = process.env.SLAX_DESKTOP_UPDATE_ENDPOINT,
    pubkey = process.env.SLAX_DESKTOP_UPDATE_PUBLIC_KEY;
  if (!endpoint || !pubkey || new URL(endpoint).protocol !== "https:")
    throw Error(
      "Supply the channel update endpoint and public verification key",
    );
  const archive = `${app}.tar.gz`;
  run("tar", ["-czf", archive, "-C", resolve(app, ".."), basename(app)]);
  // tauri reads the operator-managed signing key from its own environment; no private value is written here.
  run("pnpm", ["exec", "tauri", "signer", "sign", archive]);
  const bytes = await readFile(archive),
    signature = (await readFile(`${archive}.sig`, "utf8")).trim();
  const version = JSON.parse(await readFile("package.json", "utf8")).version;
  await writeFile(
    `${archive}.manifest.json`,
    JSON.stringify(
      {
        version,
        channel,
        environment: profile.environment,
        identifier: expected,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        signature,
        artifact: basename(archive),
      },
      null,
      2,
    ) + "\n",
  );
}
