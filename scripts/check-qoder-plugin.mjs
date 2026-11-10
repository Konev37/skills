#!/usr/bin/env node
// Static validation of qoder-plugin/ against the Qoder plugin rules.
// Exits 1 on any error. Warnings do not fail the build.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(repo, "qoder-plugin");
const errors = [];
const warnings = [];
const fail = (message) => errors.push(message);

function entries(dir) {
  return readdirSync(dir, { withFileTypes: true });
}

function walk(dir, base = dir) {
  const files = [];
  const dirs = [];
  for (const entry of entries(dir)) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      dirs.push(path);
      const nested = walk(path, base);
      files.push(...nested.files);
      dirs.push(...nested.dirs);
    } else {
      files.push(path);
    }
  }
  return { files, dirs };
}

function frontmatter(file) {
  const source = readFileSync(file, "utf8");
  const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(source);
  if (!block) return null;
  const fields = {};
  for (const line of block[1].split(/\r?\n/)) {
    const field = /^([A-Za-z][A-Za-z0-9_-]*):[ \t]*(.*)$/.exec(line);
    if (field) fields[field[1]] = field[2].replace(/^['"]|['"]$/g, "").trim();
  }
  return fields;
}

// Unresolved relative markdown links, keyed by "<skill>/<file>" so the source
// tree and the flattened tree produce comparable keys. Upstream deliberately
// contains example links to files that do not exist; only new ones are errors.
function brokenLinks(skillRoot, skillName) {
  const broken = new Set();
  const { files } = walk(skillRoot);
  for (const file of files) {
    if (!file.endsWith(".md")) continue;
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
      const target = match[1].split("#")[0];
      if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
      if (!existsSync(resolve(dirname(file), target))) {
        broken.add(`${skillName}/${relative(skillRoot, file).split(sep).join("/")} -> ${target}`);
      }
    }
  }
  return broken;
}

if (!existsSync(out)) {
  console.error("qoder-plugin/ is missing. Run node scripts/build-qoder-plugin.mjs.");
  process.exit(1);
}

const manifestPath = join(out, ".qoder-plugin", "plugin.json");
if (!existsSync(manifestPath)) {
  console.error("qoder-plugin/.qoder-plugin/plugin.json is missing.");
  process.exit(1);
}

let manifest;
try {
  manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
} catch (error) {
  console.error(`plugin.json does not parse: ${error.message}`);
  process.exit(1);
}

const claude = JSON.parse(
  readFileSync(join(repo, ".claude-plugin", "plugin.json"), "utf8"),
);

for (const field of ["name", "version", "description"]) {
  if (typeof manifest[field] !== "string" || manifest[field].trim() === "") {
    fail(`plugin.json is missing a non-empty "${field}".`);
  }
}
if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(manifest.name ?? "")) {
  fail(`plugin.json name "${manifest.name}" is not kebab-case.`);
}
if (!/^\d+\.\d+\.\d+/.test(manifest.version ?? "")) {
  fail(`plugin.json version "${manifest.version}" is not a release version.`);
}
if (manifest.version !== claude.version) {
  fail(`version ${manifest.version} does not match upstream manifest ${claude.version}.`);
}
if (manifest.name !== claude.name) {
  fail(`name ${manifest.name} does not match upstream manifest ${claude.name}.`);
}
if (!Array.isArray(manifest.keywords) || !manifest.keywords.includes("qoder-plugin")) {
  fail('plugin.json keywords must include "qoder-plugin".');
}

for (const file of ["README.md", "LICENSE"]) {
  if (!existsSync(join(out, file))) fail(`${file} is missing from the package.`);
}

const skillsField = manifest.skills;
if (typeof skillsField !== "string") {
  fail('plugin.json "skills" must be a string path.');
}
const skillsDir = resolve(out, skillsField ?? "./skills/");
if (!existsSync(skillsDir)) {
  fail(`declared skills path does not exist: ${skillsField}`);
}

const built = new Map();
if (existsSync(skillsDir)) {
  for (const entry of entries(skillsDir)) {
    const path = join(skillsDir, entry.name);
    if (!entry.isDirectory()) {
      fail(`skills/ must contain only skill directories, found file ${entry.name}.`);
      continue;
    }
    const skillFile = join(path, "SKILL.md");
    if (!existsSync(skillFile)) {
      fail(`skills/${entry.name}/ has no SKILL.md.`);
      continue;
    }
    const fields = frontmatter(skillFile);
    if (!fields) {
      fail(`skills/${entry.name}/SKILL.md has no frontmatter.`);
      continue;
    }
    if (fields.name !== entry.name) {
      fail(`skills/${entry.name}/SKILL.md declares name "${fields.name}", which does not match its directory.`);
    }
    if (!fields.description) {
      fail(`skills/${entry.name}/SKILL.md has no description.`);
    }
    if (built.has(fields.name)) fail(`duplicate skill name "${fields.name}".`);
    built.set(fields.name, path);

    const nested = walk(path);
    for (const file of nested.files) {
      if (file.endsWith("SKILL.md") && file !== skillFile) {
        fail(`skills/${entry.name}/ nests a second SKILL.md at ${relative(path, file)}. Qoder only scans one level.`);
      }
    }
    for (const dir of nested.dirs) {
      if (entries(dir).length === 0) fail(`empty directory: ${relative(out, dir)}`);
    }
  }
}

const expected = new Map();
for (const entry of claude.skills) {
  const source = resolve(repo, entry);
  const fields = frontmatter(join(source, "SKILL.md"));
  expected.set(fields.name, source);
}
for (const name of expected.keys()) {
  if (!built.has(name)) fail(`upstream skill "${name}" is missing from the package.`);
}
for (const name of built.keys()) {
  if (!expected.has(name)) fail(`package skill "${name}" is not in the upstream manifest.`);
}

for (const [name, path] of built) {
  const source = expected.get(name);
  if (!source) continue;
  const before = brokenLinks(source, name);
  for (const link of brokenLinks(path, name)) {
    if (!before.has(link)) fail(`flattening broke a link: ${link}`);
  }
}

const forbidden = new Set([
  ".git", ".claude", ".idea", ".DS_Store", "__MACOSX", "node_modules",
  "settings.json", "installed_plugins_v2.json", "installed_plugins.json",
  ".env", "credentials.json", "id_rsa",
]);
const secretPatterns = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bghp_[A-Za-z0-9]{30,}/,
  /\bsk-[A-Za-z0-9_-]{20,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /[A-Za-z]:\\Users\\[^\\\s]+/,
  /\/(?:Users|home)\/[a-z0-9._-]+\//,
];

const { files, dirs } = walk(out);
for (const dir of [out, ...dirs]) {
  if (entries(dir).length === 0) fail(`empty directory: ${relative(out, dir) || "."}`);
}
for (const file of files) {
  const name = file.split(sep).pop();
  if (forbidden.has(name) || /^\.env\..+$/.test(name) || /\.(pem|key)$/.test(name)) {
    fail(`local state or credential file in package: ${relative(out, file)}`);
    continue;
  }
  if (!/\.(md|json|sh|yaml|yml|txt|svg|cjs|mjs|js|ts)$/.test(name)) continue;
  const text = readFileSync(file, "utf8");
  for (const pattern of secretPatterns) {
    if (pattern.test(text)) {
      fail(`possible secret or machine-specific path in ${relative(out, file)} (${pattern}).`);
    }
  }
}

for (const warning of warnings) console.warn(`warn: ${warning}`);
if (errors.length > 0) {
  console.error(`qoder-plugin/ failed validation:\n${errors.map((e) => `  ${e}`).join("\n")}`);
  process.exit(1);
}
console.log(
  `qoder-plugin/ validated: ${manifest.name}@${manifest.version}, ${built.size} skills, ${files.length} files`,
);