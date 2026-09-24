import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const generatedDirectory = path.join(projectRoot, "docs", "codex", "generated");
const routesSource = path.join(projectRoot, "app", "navigation", "routes.ts");
const apiSources = [
  path.join(projectRoot, "server", "api.js"),
  path.join(projectRoot, "server", "modules", "bootstrap-router.js"),
  path.join(projectRoot, "server", "modules", "location-router.js"),
];
const migrationsDirectory = path.join(projectRoot, "mysql", "migrations");
const generatedHeader = (source, command) => `<!-- GENERATED FILE: do not edit directly. Source: ${source}. Command: ${command}. -->\n`;

function routePaths(argument) {
  const quoted = [...argument.matchAll(/['"]([^'"]+)['"]/g)].map((match) => match[1]);
  return quoted.length ? quoted : [];
}

function extractBackendRoutes(source) {
  const routes = [];
  const routePattern = /\brouter\.(get|post|put|patch|delete)\(\s*((?:\[[\s\S]*?\])|(?:['"][^'"]+['"]))/g;
  for (const match of source.matchAll(routePattern)) {
    for (const routePath of routePaths(match[2])) routes.push({ method: match[1].toUpperCase(), path: `/api${routePath}` });
  }
  return routes;
}

function extractObjectRoutes(source, constantName) {
  const start = source.indexOf(`export const ${constantName}`);
  if (start < 0) return [];
  const open = source.indexOf("{", start);
  const closeMatch = open < 0 ? null : /\}\s*(?:as const\s*)?;/.exec(source.slice(open));
  if (open < 0 || !closeMatch) return [];
  const body = source.slice(open + 1, open + closeMatch.index);
  const routes = [];
  for (const match of body.matchAll(/^\s*(["'\w-]+)\s*:\s*["']([^"']+)["'],?/gm)) {
    routes.push({ key: match[1].replace(/^['"]|['"]$/g, ""), path: match[2] });
  }
  return routes;
}

function extractFrontendRoutes(source) {
  const groups = [
    ["mainViewPaths", extractObjectRoutes(source, "mainViewPaths")],
    ["profileTabPaths", extractObjectRoutes(source, "profileTabPaths")],
    ["mobileProfileSocialPaths", extractObjectRoutes(source, "mobileProfileSocialPaths")],
  ];
  return groups.flatMap(([constant, routes]) => routes.map((route) => ({ constant, ...route })));
}

function tableReferences(sql) {
  const references = [];
  const pattern = /\b(CREATE|ALTER)\s+TABLE\s+(?:IF\s+(?:NOT\s+)?EXISTS\s+)?[`"]?([A-Za-z0-9_]+)[`"]?/gi;
  for (const match of sql.matchAll(pattern)) references.push(`${match[1].toUpperCase()} TABLE ${match[2]}`);
  return references;
}

async function migrationInventory() {
  const names = (await readdir(migrationsDirectory)).filter((name) => name.endsWith(".sql")).sort();
  return Promise.all(names.map(async (name) => ({ name, references: tableReferences(await readFile(path.join(migrationsDirectory, name), "utf8")) })));
}

function renderBackendRoutes(routes) {
  const lines = routes.map(({ method, path: routePath }) => `| \`${method}\` | \`${routePath}\` |`);
  return `${generatedHeader("server/api.js and server/modules/* routers", "pnpm docs:generate")}# Generated production API route inventory\n\nProduction Express routes only; demo-api routes are intentionally excluded. The \`/api\` prefix is the mount point from \`server/index.js\`.\n\n| Method | Path |\n| --- | --- |\n${lines.join("\n")}\n`;
}

function renderFrontendRoutes(routes) {
  const lines = routes.map(({ constant, key, path: routePath }) => `| \`${constant}\` | \`${key}\` | \`${routePath}\` |`);
  return `${generatedHeader("app/navigation/routes.ts", "pnpm docs:generate")}# Generated frontend route constants\n\nOnly exported route maps with statically extractable string values are listed. Dynamic overlay and workflow patterns remain documented semantically in [ROUTES_AND_API.md](../ROUTES_AND_API.md).\n\n| Constant | Key | Path |\n| --- | --- | --- |\n${lines.join("\n")}\n`;
}

function renderSchema(inventory) {
  const lines = inventory.map(({ name, references }) => `| \`${name}\` | ${references.length ? references.map((reference) => `\`${reference}\``).join(", ") : "—"} |`);
  return `${generatedHeader("mysql/migrations/*.sql", "pnpm docs:generate")}# Generated migration/schema inventory\n\nThis is a deterministic file-level inventory of migration names and \`CREATE TABLE\`/\`ALTER TABLE\` references. Field semantics and ownership remain in [DATA_MODEL.md](../DATA_MODEL.md).\n\n| Migration | Table references |\n| --- | --- |\n${lines.join("\n")}\n`;
}

async function buildDocuments() {
  const [apiSourcesText, routeSource, inventory] = await Promise.all([
    Promise.all(apiSources.map((file) => readFile(file, "utf8"))),
    readFile(routesSource, "utf8"),
    migrationInventory(),
  ]);
  const routes = apiSourcesText.flatMap(extractBackendRoutes).sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : left.method < right.method ? -1 : left.method > right.method ? 1 : 0);
  return {
    "API_ROUTES.md": renderBackendRoutes(routes),
    "FRONTEND_ROUTES.md": renderFrontendRoutes(extractFrontendRoutes(routeSource)),
    "SCHEMA.md": renderSchema(inventory),
  };
}

const checkOnly = process.argv.includes("--check");
const documents = await buildDocuments();
if (!checkOnly) await mkdir(generatedDirectory, { recursive: true });
let drift = false;
for (const [name, content] of Object.entries(documents)) {
  const file = path.join(generatedDirectory, name);
  let current = "";
  try {
    current = await readFile(file, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (checkOnly) {
    if (current !== content) {
      drift = true;
      console.error(`Generated documentation drift: docs/codex/generated/${name}`);
    }
  } else {
    await writeFile(file, content, "utf8");
  }
}
if (checkOnly && drift) process.exitCode = 1;
