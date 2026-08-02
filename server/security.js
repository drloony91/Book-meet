import { promisify } from "node:util";
import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const scryptAsync = promisify(scrypt);
const SESSION_COOKIE = "book_meet_session";

export function normalizeIdentity(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ").toLocaleLowerCase("ru-RU");
}

export function normalizeEmail(value) {
  return String(value ?? "").trim().toLocaleLowerCase("en-US");
}

export function isValidEmail(value) {
  const email = normalizeEmail(value);
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const derived = await scryptAsync(password, salt, 64);
  return `scrypt:${salt}:${Buffer.from(derived).toString("hex")}`;
}

export async function verifyPassword(password, stored) {
  const [algorithm, salt, expectedHex] = String(stored ?? "").split(":");
  if (algorithm !== "scrypt" || !salt || !expectedHex) return false;
  const actual = Buffer.from(await scryptAsync(password, salt, 64));
  const expected = Buffer.from(expectedHex, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function createSessionToken() {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashSessionToken(token) };
}

export function hashSessionToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

export function readCookie(request, name = SESSION_COOKIE) {
  const header = request.headers.cookie ?? "";
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

export function sessionCookie(token, request) {
  const secure = request.secure || request.headers["x-forwarded-proto"] === "https" || process.env.NODE_ENV === "production";
  const days = Math.max(1, Number(process.env.SESSION_DAYS || 7));
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${days * 86400}${secure ? "; Secure" : ""}`;
}

export function clearSessionCookie(request) {
  const secure = request.secure || request.headers["x-forwarded-proto"] === "https" || process.env.NODE_ENV === "production";
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`;
}

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const RECOVERY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generateTotpSecret() {
  const bytes = randomBytes(20);
  let bits = "";
  for (const byte of bytes) bits += byte.toString(2).padStart(8, "0");
  let result = "";
  for (let index = 0; index < bits.length; index += 5) {
    result += BASE32_ALPHABET[Number.parseInt(bits.slice(index, index + 5).padEnd(5, "0"), 2)];
  }
  return result;
}

function decodeBase32(value) {
  const cleaned = String(value ?? "").toUpperCase().replace(/=+$/g, "").replace(/[^A-Z2-7]/g, "");
  let bits = "";
  for (const character of cleaned) {
    const index = BASE32_ALPHABET.indexOf(character);
    if (index < 0) return Buffer.alloc(0);
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  return Buffer.from(bytes);
}

function totpAt(secret, counter) {
  const key = decodeBase32(secret);
  if (!key.length) return "";
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", key).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const number = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(number).padStart(6, "0");
}

export function verifyTotp(secret, code, now = Date.now()) {
  const candidate = String(code ?? "").replace(/\s+/g, "");
  if (!/^\d{6}$/.test(candidate)) return false;
  const counter = Math.floor(now / 30_000);
  return [-1, 0, 1].some((offset) => {
    const expected = Buffer.from(totpAt(secret, counter + offset));
    const actual = Buffer.from(candidate);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  });
}

export function generateRecoveryCodes(count = 10) {
  return Array.from({ length: count }, () => {
    let value = "";
    for (const byte of randomBytes(12)) value += RECOVERY_ALPHABET[byte % RECOVERY_ALPHABET.length];
    return `BM-${value.slice(0, 4)}-${value.slice(4, 8)}-${value.slice(8, 12)}`;
  });
}

export function normalizeRecoveryCode(value) {
  return String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function hashRecoveryCode(value) {
  return createHash("sha256").update(normalizeRecoveryCode(value)).digest("hex");
}

export function recoveryCodeIndex(hashes, candidate) {
  const actual = Buffer.from(hashRecoveryCode(candidate), "hex");
  return (Array.isArray(hashes) ? hashes : []).findIndex((hash) => {
    const expected = Buffer.from(String(hash), "hex");
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  });
}

export function transientCookie(name, value, request, maxAge = 600) {
  const secure = request.secure || request.headers["x-forwarded-proto"] === "https" || process.env.NODE_ENV === "production";
  const sameSite = secure ? "None" : "Lax";
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=${sameSite}; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}

export function clearTransientCookie(name, request) {
  return transientCookie(name, "", request, 0);
}
