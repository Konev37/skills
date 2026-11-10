#!/usr/bin/env node
// Builds qoder-plugin/ from .claude-plugin/plugin.json, which stays the single
// source of truth for the version and the shipped skill set. Upstream can add,
// rename or drop skills and this build follows without edits here.
//
// Qoder discovers skills at skills/<name>/SKILL.md, one level deep, while this
// repo keeps them at skills/<bucket>/<name>/SKILL.md. The build flattens them.
//
// With --check it writes nothing to qoder-plugin/ and exits 1 on drift.

import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outName = "qoder-plugin";
const forkUrl = "https://github.com/Konev37/skills";

const check = process.argv.includes("--check");
const claude = JSON.parse(
  readFileSync(join(repo, ".claude-plugin", "plugin.json"), "utf8"),
);

if (!Array.isArray(claude.skills) || claude.skills.length === 0) {
  console.error(".claude-plugin/plugin.json has no skills array to build from.");
  process.exit(1);
}

function frontmatterName(skillDir) {
  const source = readFileSync(join(skillDir, "SKILL.md"), "utf8");
  const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(source);
  if (!block) {
    throw new Error(`${relative(repo, skillDir)}/SKILL.md has no frontmatter.`);
  }
  const field = /^name:[ \t]*(.+?)[ \t]*$/m.exec(block[1]);
  if (!field) {
    throw new Error(`${relative(repo, skillDir)}/SKILL.md has no name field.`);
  }
  return field[1].replace(/^['"]|['"]$/g, "");
}

function build(target) {
  mkdirSync(join(target, ".qoder-plugin"), { recursive: true });
  mkdirSync(join(target, "skills"), { recursive: true });

  const seen = new Map();
  for (const entry of claude.skills) {
    const source = resolve(repo, entry);
    if (!existsSync(join(source, "SKILL.md"))) {
      throw new Error(`Manifest lists ${entry}, but it has no SKILL.md.`);
    }
    const name = frontmatterName(source);
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) {
      throw new Error(`Skill name "${name}" in ${entry} is not kebab-case.`);
    }
    if (seen.has(name)) {
      throw new Error(
        `Skill name "${name}" is claimed by both ${seen.get(name)} and ${entry}.`,
      );
    }
    seen.set(name, entry);

    // agents/openai.yaml is Codex metadata. Qoder does not read it, and the
    // invocation policy it carries is already in SKILL.md frontmatter.
    cpSync(source, join(target, "skills", name), {
      recursive: true,
      filter: (path) => relative(source, path).split(sep)[0] !== "agents",
    });
  }

  const manifest = {
    name: claude.name,
    displayName: "Matt Pocock Skills",
    version: claude.version,
    description: claude.description,
    author: claude.author,
    homepage: claude.homepage,
    repository: forkUrl,
    license: claude.license,
    keywords: ["qoder-plugin", ...claude.keywords],
    skills: "./skills/",
  };
  for (const key of Object.keys(manifest)) {
    if (manifest[key] === undefined) delete manifest[key];
  }
  writeFileSync(
    join(target, ".qoder-plugin", "plugin.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );

  cpSync(join(repo, "LICENSE"), join(target, "LICENSE"));
  cpSync(join(repo, "QODER.md"), join(target, "README.md"));

  return [...seen.keys()].sort();
}

function walk(dir, base = dir) {
  const files = new Map();
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      for (const [key, value] of walk(path, base)) files.set(key, value);
    } else {
      files.set(relative(base, path).split(sep).join("/"), readFileSync(path));
    }
  }
  return files;
}

// Line endings are a checkout artifact (core.autocrlf), not content. Compare
// normalized text so a Windows clone does not report false drift.
const normalize = (buffer) => buffer.toString("utf8").replace(/\r\n/g, "\n");

function compare(built, committed) {
  const problems = [];
  for (const [path, content] of built) {
    if (!committed.has(path)) problems.push(`missing: ${outName}/${path}`);
    else if (normalize(content) !== normalize(committed.get(path)))
      problems.push(`stale: ${outName}/${path}`);
  }
  for (const path of committed.keys()) {
    if (!built.has(path)) problems.push(`unexpected: ${outName}/${path}`);
  }
  return problems;
}

if (check) {
  const temp = mkdtempSync(join(tmpdir(), "qoder-plugin-check-"));
  try {
    build(temp);
    const out = join(repo, outName);
    if (!existsSync(out)) {
      console.error(`${outName}/ is missing. Run node scripts/build-qoder-plugin.mjs.`);
      process.exit(1);
    }
    const problems = compare(walk(temp), walk(out));
    if (problems.length > 0) {
      console.error(
        `${outName}/ is out of date:\n${problems.map((p) => `  ${p}`).join("\n")}\nRun node scripts/build-qoder-plugin.mjs.`,
      );
      process.exit(1);
    }
    console.log(`${outName}/ is in sync with .claude-plugin/plugin.json`);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
  process.exit(0);
}

const out = join(repo, outName);
if (existsSync(out)) {
  // Refuse to clear a directory this script did not generate.
  const marker = join(out, ".qoder-plugin", "plugin.json");
  if (!existsSync(marker)) {
    console.error(`${outName}/ exists without .qoder-plugin/plugin.json. Move it aside first.`);
    process.exit(1);
  }
  if (JSON.parse(readFileSync(marker, "utf8")).name !== claude.name) {
    console.error(`${outName}/ holds a different plugin. Move it aside first.`);
    process.exit(1);
  }
  rmSync(out, { recursive: true, force: true });
}

const names = build(out);
console.log(
  `Built ${outName}/ ${claude.name}@${claude.version} with ${names.length} skills`,
);