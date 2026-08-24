import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDirectory = path.join(projectRoot, "mysql", "migrations");
const names = (await readdir(migrationsDirectory)).filter((name) => name.endsWith(".sql")).sort();
const failures = [];

if (names.length === 0) failures.push("mysql/migrations must contain at least one .sql file");

const ids = [];
for (const name of names) {
  const match = /^(\d{3})_[^/]+\.sql$/.exec(name);
  if (!match) {
    failures.push(`${name}: expected a three-digit prefix and .sql extension`);
    continue;
  }
  ids.push({ id: Number(match[1]), name });
  const sql = await readFile(path.join(migrationsDirectory, name), "utf8");
  const withoutComments = sql.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*--.*$/gm, "").trim();
  if (!withoutComments) failures.push(`${name}: SQL must not be empty`);
  if (!sql.trimEnd().endsWith(";")) failures.push(`${name}: SQL must end with a terminal semicolon`);
}

const idValues = ids.map(({ id }) => id);
if (new Set(idValues).size !== idValues.length) failures.push("migration numeric prefixes must be unique");
const expected = Array.from({ length: ids.length }, (_, index) => index + 1);
if (idValues.some((id, index) => id !== expected[index])) failures.push("migration numeric prefixes must be contiguous and lexicographically ordered starting at 001");

if (failures.length) {
  console.error(failures.map((failure) => `Migration check failed: ${failure}`).join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Migration check passed: ${names.length} sorted, contiguous migrations.`);
}
