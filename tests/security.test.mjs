import test from "node:test";
import assert from "node:assert/strict";
import { createSessionToken, generateRecoveryCodes, hashPassword, hashRecoveryCode, normalizeEmail, normalizeIdentity, recoveryCodeIndex, verifyPassword, verifyTotp } from "../server/security.js";

test("пароли хранятся как scrypt-хэши", async () => {
  const hash = await hashPassword("testtest1");
  assert.match(hash, /^scrypt:[a-f0-9]{32}:[a-f0-9]{128}$/);
  assert.equal(await verifyPassword("testtest1", hash), true);
  assert.equal(await verifyPassword("wrong", hash), false);
});

test("идентификаторы пользователей нормализуются одинаково", () => {
  assert.equal(normalizeIdentity("  Тест   1 "), "тест 1");
  assert.equal(normalizeEmail("  User@Example.COM "), "user@example.com");
});

test("в базе хранится хэш сессии, а не cookie-токен", () => {
  const { token, tokenHash } = createSessionToken();
  assert.notEqual(token, tokenHash);
  assert.match(tokenHash, /^[a-f0-9]{64}$/);
});

test("TOTP принимает действующий код и отклоняет неверный", () => {
  const rfcSecret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
  assert.equal(verifyTotp(rfcSecret, "287082", 59_000), true);
  assert.equal(verifyTotp(rfcSecret, "000000", 59_000), false);
});

test("резервные коды уникальны, хранятся как хэши и распознаются без учёта дефисов", () => {
  const codes = generateRecoveryCodes();
  assert.equal(codes.length, 10);
  assert.equal(new Set(codes).size, 10);
  assert.ok(codes.every((code) => /^BM-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(code)));
  const hashes = codes.map(hashRecoveryCode);
  assert.ok(hashes.every((hash) => /^[a-f0-9]{64}$/.test(hash)));
  assert.equal(recoveryCodeIndex(hashes, codes[3].replaceAll("-", "")), 3);
  assert.equal(recoveryCodeIndex(hashes, "BM-WRONG-CODE"), -1);
});
