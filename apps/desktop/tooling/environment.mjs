import { readFileSync } from "node:fs";

export const environments = JSON.parse(
  readFileSync(new URL("../config/environments.json", import.meta.url), "utf8"),
);

function origin(value, local) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw Error("Desktop origins must be canonical HTTP(S) origins");
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    typeof value !== "string" ||
    /[\r\n]/.test(value) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    (local
      ? !loopback || !["http:", "https:"].includes(url.protocol)
      : loopback || url.protocol !== "https:")
  ) {
    throw Error(
      local
        ? "The local environment requires loopback API and Web origins"
        : "Remote environments require HTTPS API and Web origins",
    );
  }
  return url.origin;
}

export function selectEnvironment(args, processEnvironment = process.env) {
  let name, channel;
  const forwarded = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--env" || arg === "--channel") {
      const value = args[++index];
      if (
        !value ||
        value.startsWith("--") ||
        (arg === "--env" ? name !== undefined : channel !== undefined)
      )
        throw Error("Specify one --env local|preview|beta|main");
      if (arg === "--env") name = value;
      else channel = value;
    } else forwarded.push(arg);
  }
  const channelEnvironment = { dev: "preview", beta: "beta", main: "main" }[
    channel
  ];
  if (channel !== undefined && !channelEnvironment)
    throw Error(
      "Release channels are dev, beta, or main; select local with --env local",
    );
  if (name && channelEnvironment && name !== channelEnvironment)
    throw Error("--env and --channel select different environments");
  name ??= channelEnvironment ?? processEnvironment.SLAX_DESKTOP_ENV ?? "local";
  if (!Object.hasOwn(environments, name))
    throw Error("Desktop --env must be local, preview, beta, or main");
  const profile = { ...environments[name], environment: name };
  const api = processEnvironment.SLAX_DESKTOP_API_ORIGIN,
    web = processEnvironment.SLAX_DESKTOP_WEB_ORIGIN;
  if ((api === undefined) !== (web === undefined))
    throw Error(
      "Override both SLAX_DESKTOP_API_ORIGIN and SLAX_DESKTOP_WEB_ORIGIN together",
    );
  profile.apiOrigin = origin(api ?? profile.apiOrigin, name === "local");
  profile.webOrigin = origin(web ?? profile.webOrigin, name === "local");
  return { profile, forwarded };
}

export function buildEnvironment(profile) {
  return {
    ...process.env,
    SLAX_DESKTOP_ENV: profile.environment,
    SLAX_DESKTOP_CHANNEL: profile.channel,
    SLAX_DESKTOP_BUNDLE_ID: profile.identifier,
    SLAX_DESKTOP_API_ORIGIN: profile.apiOrigin,
    SLAX_DESKTOP_WEB_ORIGIN: profile.webOrigin,
  };
}

export function tauriConfiguration(profile) {
  return {
    identifier: profile.identifier,
    productName: profile.productName,
    plugins: {
      "deep-link": { desktop: { schemes: [profile.callbackScheme] } },
    },
  };
}
