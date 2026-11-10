#!/usr/bin/env node
// Installs or updates this repo's plugin in a local Qoder config directory.
// A @local install never updates itself, so this replays the manual flow:
// build, copy into the versioned cache, then merge both JSON documents.
//
//   node scripts/update-local-qoder-plugin.mjs
//   node scripts/update-local-qoder-plugin.mjs --dry-run
//   node scripts/update-local-qoder-plugin.mjs --config-dir /path/to/.qoder-cn

import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");
const flagIndex = argv.indexOf("--config-dir");
const explicitDir = flagIndex === -1 ? null : argv[flagIndex + 1];

if (flagIndex !== -1 && !explicitDir) {
  console.error("--config-dir needs a path.");
  process.exit(1);
}

function resolveConfigDir() {
  if (explicitDir) return resolve(explicitDir);
  const fromEnv = process.env.QODER_CONFIG_DIR || process.env.QODERCN_CONFIG_DIR;
  if (fromEnv) return resolve(fromEnv);
  const candidates = [join(homedir(), ".qoder-cn"), join(homedir(), ".qoder")];
  const found = candidates.filter((dir) => existsSync(dir));
  if (found.length === 1) return found[0];
  console.error(
    found.length === 0
      ? "No Qoder config directory found. Pass --config-dir <path>."
      : `Both ${found.join(" and ")} exist. Pass --config-dir <path> to pick one.`,
  );
  process.exit(1);
}

const config = resolveConfigDir();
const built = join(repo, "qoder-plugin");

if (!dryRun) {
  execFileSync(process.execPath, [join(repo, "scripts", "build-qoder-plugin.mjs")], {
    stdio: "inherit",
  });
}
if (!existsSync(join(built, ".qoder-plugin", "plugin.json"))) {
  console.error("qoder-plugin/ is not built. Run scripts/build-qoder-plugin.mjs first.");
  process.exit(1);
}

const manifest = JSON.parse(
  readFileSync(join(built, ".qoder-plugin", "plugin.json"), "utf8"),
);
const id = `${manifest.name}@local`;
const cacheRoot = join(config, "plugins", "cache", "local", manifest.name);
const target = join(cacheRoot, manifest.version);

const registryPath = join(config, "plugins", "installed_plugins_v2.json");
const settingsPath = join(config, "settings.json");

function readJson(path, fallback) {
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : fallback;
}

const registry = readJson(registryPath, { version: 2, plugins: {} });
const settings = readJson(settingsPath, {});
registry.plugins ??= {};
settings.enabledPlugins ??= {};

const previous = registry.plugins[id]?.[0];
const entry = {
  scope: "user",
  installPath: target,
  version: manifest.version,
};
if (previous?.displayName) entry.displayName = previous.displayName;

const stale = existsSync(cacheRoot)
  ? readdirSync(cacheRoot, { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name !== manifest.version)
      .map((d) => d.name)
  : [];

console.log(`Config directory: ${config}`);
console.log(`Plugin:           ${id}`);
console.log(`Version:          ${previous?.version ?? "(not installed)"} -> ${manifest.version}`);
console.log(`Cache target:     ${target}`);
console.log(`Skills:           ${manifest.skills}`);

if (dryRun) {
  console.log("\nDry run, nothing written. Would:");
  console.log(`  copy qoder-plugin/ into ${target}`);
  console.log(`  set plugins["${id}"] in ${registryPath}`);
  console.log(`  set enabledPlugins["${id}"] = true in ${settingsPath}`);
  if (stale.length) console.log(`  leave older cache versions in place: ${stale.join(", ")}`);
  process.exit(0);
}

mkdirSync(target, { recursive: true });
rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
cpSync(built, target, { recursive: true });

registry.plugins[id] = [entry];
writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`);

settings.enabledPlugins[id] = true;
writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);

console.log(`\nInstalled ${id} at ${manifest.version}. Restart Qoder to load it.`);
if (stale.length) {
  console.log(
    `Older cache versions left in place (delete by hand if you want): ${stale.map((v) => join(cacheRoot, v)).join(", ")}`,
  );
}

const rival = Object.keys(settings.enabledPlugins).find(
  (key) =>
    key !== id &&
    key.startsWith("matt-pocock-skills@") &&
    settings.enabledPlugins[key] === true,
);
if (rival) {
  console.log(
    `Note: ${rival} is also enabled and ships the same skill names. Disable it in the Extensions view to avoid duplicates.`,
  );
}