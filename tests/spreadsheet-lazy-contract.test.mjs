import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function frontendSourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return frontendSourceFiles(entryPath);
    return /\.(ts|tsx)$/.test(entry.name) ? [entryPath] : [];
  }));
  return files.flat();
}

test("frontend spreadsheet consumers load xlsx through the shared lazy helper", async () => {
  const frontendFiles = await frontendSourceFiles(path.join(root, "app"));
  const [helper, content, profile, ...frontendSources] = await Promise.all([
    readFile(path.join(root, "app", "services", "spreadsheet.ts"), "utf8"),
    readFile(path.join(root, "app", "components", "content", "ContentComponents.tsx"), "utf8"),
    readFile(path.join(root, "app", "screens", "ProfileScreens.tsx"), "utf8"),
    ...frontendFiles.map((file) => readFile(file, "utf8")),
  ]);

  assert.match(helper, /await import\(["']xlsx["']\)/);
  assert.match(helper, /file\.arrayBuffer\(\)/);
  assert.match(helper, /sheet_to_json/);
  assert.doesNotMatch(frontendSources.join("\n"), /import\s+(?:\*\s+as\s+XLSX|XLSX\s+from|\{[^}]*\bXLSX\b[^}]*\})\s+from\s+["']xlsx["']/);
  assert.match(content, /readFirstWorksheetRows\(file\)/);
  assert.match(profile, /readFirstWorksheetRows\(file\)/);
});
