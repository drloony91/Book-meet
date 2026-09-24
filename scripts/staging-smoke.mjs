import { spawn } from "node:child_process";
import { once } from "node:events";
import { access, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { getPool, closePool } from "../server/db.js";
import { createSessionToken } from "../server/security.js";

const EXPECTED_PROFILE_TYPES = ["Читатель", "Писатель", "Блогер", "Издатель", "Сообщество"];
const ORGANIZATION_TYPES = new Set(["Издатель", "Сообщество"]);
const MARKETPLACE_URLS = {
  flip: "https://www.flip.kz/catalog?prod=6014335",
  marwin: "https://www.meloman.kz/populyarnaya-psihologiya/rudenok-l-put-v-podsoznanie-kak-poznat-sebja-i-oschutit-radost-zhizni.html",
  yandex: "https://books.yandex.kz/books/DqAYDJFq",
};

function stagingGuard() {
  const origin = new URL(process.env.APP_ORIGIN || "http://invalid.local");
  const dbName = String(process.env.DB_NAME || "").toLowerCase();
  const uploadDir = String(process.env.UPLOAD_DIR || "").toLowerCase();
  const problems = [];
  if (process.env.STAGING_SMOKE !== "1") problems.push("STAGING_SMOKE=1");
  if (process.env.NODE_ENV !== "production") problems.push("NODE_ENV=production");
  if (origin.hostname !== "staging.bookmeet.club") problems.push("staging APP_ORIGIN");
  if (!/(?:stg|staging)/.test(dbName)) problems.push("staging DB_NAME");
  if (!uploadDir.includes("staging")) problems.push("staging UPLOAD_DIR");
  if (process.env.TELEGRAM_ALERTS_ENABLED === "1") problems.push("Telegram alerts disabled");
  if (process.env.GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_SECRET) problems.push("Google OAuth disabled");
  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS && process.env.MAIL_FROM) problems.push("SMTP disabled");
  if (problems.length) throw new Error(`Staging smoke guard failed: ${problems.join(", ")}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function freePort() {
  const server = net.createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  server.close();
  await once(server, "close");
  return port;
}

async function startServer(port) {
  const output = [];
  const child = spawn(process.execPath, ["server/index.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      APP_ORIGIN: `http://127.0.0.1:${port}`,
      TELEGRAM_ALERTS_ENABLED: "0",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => output.push(String(chunk)));
  child.stderr.on("data", (chunk) => output.push(String(chunk)));
  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Smoke server stopped early: ${output.join("").slice(-1000)}`);
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return { child, baseUrl, output };
    } catch { /* wait for startup */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  child.kill("SIGTERM");
  throw new Error(`Smoke server did not become healthy: ${output.join("").slice(-1000)}`);
}

async function stopServer(server) {
  if (!server || server.exitCode !== null) return;
  server.kill("SIGTERM");
  await Promise.race([once(server, "exit"), new Promise((resolve) => setTimeout(resolve, 5_000))]);
  if (server.exitCode === null) server.kill("SIGKILL");
}

async function request(baseUrl, pathname, { method = "GET", token, body } = {}) {
  const headers = { accept: "application/json" };
  if (token) headers.cookie = `book_meet_session=${encodeURIComponent(token)}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { text: text.slice(0, 500) }; }
  return { status: response.status, headers: response.headers, data };
}

function profilePayload(user, cityId) {
  const type = user.profile.type;
  const organization = ORGANIZATION_TYPES.has(type);
  return {
    profile: {
      ...user.profile,
      name: user.profile.name,
      type,
      city: organization ? "" : user.profile.city || "Астана",
      cityId: organization ? undefined : user.profile.cityId || cityId,
      gender: organization ? "Не указан" : user.profile.gender || "Не указан",
      birthDate: organization ? "" : user.profile.birthDate || "1990-01-01",
      favoriteGenres: organization ? [] : user.profile.favoriteGenres || [],
      dislikedGenres: organization ? [] : user.profile.dislikedGenres || [],
      publisherWebsite: type === "Издатель" ? user.profile.publisherWebsite || "" : "",
      publisherSalesLinks: type === "Издатель" ? user.profile.publisherSalesLinks || [] : [],
      communityType: type === "Сообщество" ? user.profile.communityType || "Книжное сообщество" : "",
      communityRules: type === "Сообщество" ? user.profile.communityRules || "" : "",
      communityIsClosed: type === "Сообщество" && Boolean(user.profile.communityIsClosed),
    },
    reviews: user.reviews || [],
    excerpts: user.excerpts || [],
    publisherNews: user.publisherNews || [],
  };
}

async function createSmokeSessions(pool, users) {
  const sessions = new Map();
  for (const user of users) {
    const { token, tokenHash } = createSessionToken();
    await pool.query(
      `INSERT INTO sessions (token_hash, user_id, expires_at, last_seen_at, ip_hash, user_agent_hash)
       VALUES (?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 2 HOUR), UTC_TIMESTAMP(), NULL, NULL)`,
      [tokenHash, user.id],
    );
    sessions.set(user.id, { token, tokenHash });
  }
  return sessions;
}

async function cleanupSmokeSessions(pool, sessions) {
  const hashes = [...sessions.values()].map((entry) => entry.tokenHash);
  if (!hashes.length) return;
  await pool.query(`DELETE FROM sessions WHERE token_hash IN (${hashes.map(() => "?").join(", ")})`, hashes);
}

async function verifyUploadMarker(uploadRoot, markerPath, { cleanup = false } = {}) {
  const expected = "book-meet-staging-upload-persistence-check\n";
  const actual = await readFile(markerPath, "utf8");
  assert(actual === expected, "Upload persistence marker changed");
  if (cleanup) await unlink(markerPath);
  console.log(JSON.stringify({
    uploadPersistenceAfterRestart: "PASS",
    uploadMarkerCleanup: cleanup ? "PASS" : "NOT_REQUESTED",
    uploadRoot,
  }, null, 2));
}

stagingGuard();

const uploadRoot = path.resolve(process.cwd(), process.env.UPLOAD_DIR);
const markerPath = path.join(uploadRoot, ".staging-upload-persistence-check");

const verifyMarker = process.argv.includes("--verify-upload-marker");
const cleanupMarker = process.argv.includes("--cleanup-upload-marker");
if (cleanupMarker && !verifyMarker) throw new Error("--cleanup-upload-marker requires --verify-upload-marker");

if (verifyMarker) {
  await verifyUploadMarker(uploadRoot, markerPath, { cleanup: cleanupMarker });
  process.exit(0);
}

const pool = getPool();
let server;
let sessions = new Map();
try {
  await mkdir(uploadRoot, { recursive: true });
  await access(uploadRoot);
  await writeFile(markerPath, "book-meet-staging-upload-persistence-check\n", { encoding: "utf8", mode: 0o600 });

  const [profileRows] = await pool.query(
    `SELECT u.id, p.profile_type AS profileType
       FROM users u JOIN profiles p ON p.user_id = u.id
      WHERE u.purged_at IS NULL
      ORDER BY u.id`,
  );
  const counts = Object.fromEntries(EXPECTED_PROFILE_TYPES.map((type) => [type, profileRows.filter((row) => row.profileType === type).length]));
  assert(EXPECTED_PROFILE_TYPES.every((type) => counts[type] === 1), `Expected exactly one staging profile of each type: ${JSON.stringify(counts)}`);

  const [[city]] = await pool.query("SELECT id FROM cities WHERE name = 'Астана' ORDER BY id LIMIT 1");
  assert(city?.id, "Astana city fixture is missing");
  sessions = await createSmokeSessions(pool, profileRows);

  const port = await freePort();
  ({ child: server } = await startServer(port));
  const baseUrl = `http://127.0.0.1:${port}`;
  const health = await request(baseUrl, "/api/health");
  assert(health.status === 200 && health.data?.ok && health.data?.database === "mysql", "Internal health failed");

  const profileResults = {};
  let publisherUser;
  for (const row of profileRows) {
    const token = sessions.get(row.id).token;
    const bootstrap = await request(baseUrl, "/api/bootstrap", { token });
    assert(bootstrap.status === 200, `Bootstrap failed for ${row.profileType}`);
    const user = bootstrap.data.users.find((item) => Number(item.id) === Number(row.id));
    assert(user?.profile?.type === row.profileType, `Profile fixture mismatch for ${row.profileType}`);
    const payload = profilePayload(user, city.id);
    const saved = await request(baseUrl, "/api/users/me/state", { method: "PUT", token, body: payload });
    assert(saved.status === 200, `Profile save failed for ${row.profileType}: ${saved.status}`);
    const refreshed = await request(baseUrl, "/api/bootstrap", { token });
    assert(refreshed.status === 200 && refreshed.data.users.find((item) => Number(item.id) === Number(row.id))?.profile?.type === row.profileType, `Profile refresh failed for ${row.profileType}`);
    profileResults[row.profileType] = "PASS";
    if (row.profileType === "Издатель") publisherUser = { row, token, payload };
  }

  assert(publisherUser, "Publisher fixture is missing");
  const emptyOptional = await request(baseUrl, "/api/users/me/state", { method: "PUT", token: publisherUser.token, body: publisherUser.payload });
  assert(emptyOptional.status === 200, `Empty optional publisher URLs failed: ${emptyOptional.status}`);

  const malformedWebsitePayload = structuredClone(publisherUser.payload);
  malformedWebsitePayload.profile.publisherWebsite = "not a URL";
  const malformedWebsite = await request(baseUrl, "/api/users/me/state", { method: "PUT", token: publisherUser.token, body: malformedWebsitePayload });
  assert(malformedWebsite.status === 400 && malformedWebsite.data?.code === "INVALID_URL", `Malformed publisher website returned ${malformedWebsite.status}`);

  const malformedSalesPayload = structuredClone(publisherUser.payload);
  malformedSalesPayload.profile.publisherSalesLinks = [{ id: 1, label: "Store", url: "javascript:alert(1)" }];
  const malformedSales = await request(baseUrl, "/api/users/me/state", { method: "PUT", token: publisherUser.token, body: malformedSalesPayload });
  assert(malformedSales.status === 400 && malformedSales.data?.code === "INVALID_URL", `Malformed publisher sales URL returned ${malformedSales.status}`);

  const adminRow = profileRows.find((row) => row.profileType === "Читатель");
  const adminToken = sessions.get(adminRow.id).token;
  const malformedPreview = await request(baseUrl, "/api/books/preview", { method: "POST", token: adminToken, body: { productUrl: "not a URL" } });
  assert(malformedPreview.status === 400, `Malformed book preview returned ${malformedPreview.status}`);

  const marketplaceResults = {};
  for (const [marketplace, productUrl] of Object.entries(MARKETPLACE_URLS)) {
    const preview = await request(baseUrl, "/api/books/preview", { method: "POST", token: adminToken, body: { productUrl } });
    assert(preview.status === 200 && preview.data?.product?.title && preview.data?.product?.author, `${marketplace} preview returned ${preview.status}`);
    marketplaceResults[marketplace] = { status: preview.status, marketplace: preview.data.product.marketplace };
  }

  const typeRowsAfter = await pool.query(
    `SELECT p.profile_type AS profileType, COUNT(*) AS count
       FROM profiles p JOIN users u ON u.id = p.user_id
      WHERE u.purged_at IS NULL
      GROUP BY p.profile_type`,
  );
  const countsAfter = Object.fromEntries(typeRowsAfter[0].map((row) => [row.profileType, Number(row.count)]));
  assert(EXPECTED_PROFILE_TYPES.every((type) => countsAfter[type] === 1), `Profile type counts changed: ${JSON.stringify(countsAfter)}`);

  console.log(JSON.stringify({
    health: "PASS",
    profileSaveAndRefresh: profileResults,
    emptyOptionalUrls: "PASS",
    malformedPublisherWebsite: malformedWebsite.status,
    malformedPublisherSalesLinks: malformedSales.status,
    malformedBookPreview: malformedPreview.status,
    marketplacePreviews: marketplaceResults,
    uploadWriteRead: "PASS",
    uploadMarker: markerPath,
    profileTypeCounts: countsAfter,
  }, null, 2));
} finally {
  await stopServer(server);
  try { await cleanupSmokeSessions(pool, sessions); } catch (error) { console.error(`Session cleanup failed: ${error.message}`); }
  await closePool();
}
