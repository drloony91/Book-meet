import { readdir, readFile } from "node:fs/promises";
import { builtinModules } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceExtensions = new Set([".js", ".mjs", ".ts", ".tsx"]);
const clientRoots = ["app", "src"];
const serverRoots = ["server", "scripts"];
const nodeBuiltins = new Set(builtinModules.flatMap((name) => [name, name.replace(/^node:/, "")]));

async function sourceFiles(rootName) {
  const results = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (["node_modules", "dist", "tmp"].includes(entry.name)) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else if (sourceExtensions.has(path.extname(entry.name))) results.push(absolute);
    }
  }
  await visit(path.join(projectRoot, rootName));
  return results.sort();
}

function importsFrom(source) {
  const imports = [];
  const patterns = [
    /(?:^|[\n;])\s*(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/gm,
    /\bimport\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) for (const match of source.matchAll(pattern)) imports.push(match[1]);
  return imports;
}

function projectTarget(file, specifier) {
  if (specifier.startsWith("@/")) return specifier.slice(2).replaceAll("\\", "/");
  if (!specifier.startsWith(".")) return null;
  const absolute = path.resolve(path.dirname(file), specifier);
  const relative = path.relative(projectRoot, absolute).replaceAll("\\", "/");
  return relative.startsWith("../") ? null : relative;
}

const violations = [];
for (const rootName of clientRoots) {
  for (const file of await sourceFiles(rootName)) {
    const source = await readFile(file, "utf8");
    const relativeFile = path.relative(projectRoot, file).replaceAll("\\", "/");
    if (relativeFile !== "app/services/api.ts" && /\bfetch\s*\(/.test(source)) {
      violations.push(`${relativeFile} calls global fetch(); use app/services/api.ts apiFetch instead`);
    }
    for (const specifier of importsFrom(source)) {
      const builtin = specifier.replace(/^node:/, "");
      if (specifier.startsWith("node:") || nodeBuiltins.has(builtin)) {
        violations.push(`${path.relative(projectRoot, file)} imports Node builtin ${specifier}`);
      }
      const target = projectTarget(file, specifier);
      if (target && /^(?:server|mysql|scripts)(?:\/|$)/.test(target)) {
        violations.push(`${path.relative(projectRoot, file)} imports forbidden server/mysql/scripts path ${specifier}`);
      }
    }
  }
}

for (const rootName of serverRoots) {
  for (const file of await sourceFiles(rootName)) {
    const source = await readFile(file, "utf8");
    for (const specifier of importsFrom(source)) {
      const target = projectTarget(file, specifier);
      if (target && /^(?:src|app\/(?:screens|components|hooks))(?:\/|$)/.test(target)) {
        violations.push(`${path.relative(projectRoot, file)} imports forbidden UI path ${specifier}`);
      }
    }
  }
}

if (violations.length) {
  console.error(violations.map((violation) => `Architecture check failed: ${violation}`).join("\n"));
  process.exitCode = 1;
} else {
  console.log("Architecture check passed: client/server static and dynamic import boundaries are clean.");
}
