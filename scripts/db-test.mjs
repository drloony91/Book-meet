import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const composeFile = path.join(projectRoot, "compose.mysql-test.yml");
export const composeProject = "book-meet-mysql-test";

export const testDatabaseEnvironment = Object.freeze({
  NODE_ENV: "test",
  MYSQL_INTEGRATION_TEST: "1",
  DB_HOST: "127.0.0.1",
  DB_PORT: "3307",
  DB_NAME: "book_meet_test",
  DB_USER: "book_meet_test",
  DB_PASSWORD: "book_meet_test_password",
  MYSQL_TEST_ROOT_USER: "root",
  MYSQL_TEST_ROOT_PASSWORD: "book_meet_test_root_password",
  ADMIN_EMAIL: "db-test-admin@example.test",
  TEST1_PASSWORD: "db-test-admin-password",
  PUBLISHER_TEST_EMAIL: "db-test-publisher@example.test",
  PUBLISHER_TEST_PASSWORD: "db-test-publisher-password",
});

export function createTestEnvironment(overrides = {}) {
  return { ...process.env, ...testDatabaseEnvironment, ...overrides };
}

export function assertSafeIntegrationEnvironment(environment = process.env) {
  const expected = [
    ["NODE_ENV", "test"],
    ["MYSQL_INTEGRATION_TEST", "1"],
    ["DB_HOST", "127.0.0.1"],
    ["DB_PORT", "3307"],
    ["DB_NAME", "book_meet_test"],
    ["DB_USER", "book_meet_test"],
  ];
  const mismatches = expected.filter(([name, value]) => environment[name] !== value).map(([name, value]) => `${name}=${value}`);
  if (mismatches.length) {
    throw new Error(`Refusing MySQL integration operation: require exact test-only environment (${mismatches.join(", ")}).`);
  }
}

function commandFailure(command, result) {
  if (result.error) return new Error(`${command} could not start: ${result.error.message}`);
  return new Error(`${command} failed with exit code ${result.status ?? "unknown"}.`);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    env: options.env ?? process.env,
    encoding: "utf8",
    stdio: options.stdio ?? "inherit",
    shell: false,
  });
  if (result.status !== 0) throw commandFailure([command, ...args].join(" "), result);
  return result;
}

function assertComposeScope() {
  if (composeProject !== "book-meet-mysql-test" || path.basename(composeFile) !== "compose.mysql-test.yml") {
    throw new Error("Refusing destructive Compose action outside the dedicated Book Meet MySQL test project.");
  }
}

function compose(args, options) {
  assertComposeScope();
  return run("docker", ["compose", "--project-name", composeProject, "--file", composeFile, ...args], options);
}

function ensureDockerAvailable() {
  const docker = spawnSync("docker", ["version", "--format", "{{.Server.Version}}"], { cwd: projectRoot, encoding: "utf8", shell: false });
  if (docker.status !== 0) {
    throw new Error("Docker Desktop with a running Docker Engine is required for MySQL integration tests. Install/start Docker Desktop, ensure `docker compose` is available, then retry.");
  }
  const composeVersion = spawnSync("docker", ["compose", "version"], { cwd: projectRoot, encoding: "utf8", shell: false });
  if (composeVersion.status !== 0) {
    throw new Error("Docker Compose v2 is required for MySQL integration tests. Ensure `docker compose version` succeeds, then retry.");
  }
}

function up() {
  ensureDockerAvailable();
  compose(["up", "--detach", "--wait"]);
}

function down() {
  ensureDockerAvailable();
  compose(["down", "--volumes", "--remove-orphans"]);
}

function runIntegrationSuite() {
  ensureDockerAvailable();
  const running = compose(["ps", "--status", "running", "--services"], { stdio: "pipe" });
  if (!running.stdout.includes("mysql")) {
    throw new Error("The dedicated MySQL test container is not running. Run `pnpm db:test:up` first, or use `pnpm verify:db` for a disposable full run.");
  }
  run(process.execPath, ["--test", "tests/mysql-integration.test.mjs"], { env: createTestEnvironment() });
}

function verify() {
  ensureDockerAvailable();
  let primaryFailure;
  try {
    down();
    up();
    runIntegrationSuite();
  } catch (error) {
    primaryFailure = error;
    throw error;
  } finally {
    try {
      down();
    } catch (cleanupError) {
      if (primaryFailure) console.error(`MySQL test cleanup also failed: ${cleanupError.message}`);
      else throw cleanupError;
    }
  }
}

function usage() {
  console.error("Usage: node scripts/db-test.mjs <up|test|down|verify>");
  process.exitCode = 1;
}

const invokedPath = process.argv[1] && path.resolve(process.argv[1]);
if (invokedPath === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2];
  if (mode === "up") up();
  else if (mode === "test") runIntegrationSuite();
  else if (mode === "down") down();
  else if (mode === "verify") verify();
  else usage();
}
