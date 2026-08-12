import { createHash, randomBytes } from "node:crypto";

export const EMAIL_VERIFICATION_TTL_MINUTES = 24 * 60;
export const PASSWORD_RESET_TTL_MINUTES = 30;

export function createOpaqueActionToken() {
  return randomBytes(32).toString("base64url");
}

export function hashAccountActionToken(token) {
  return createHash("sha256").update(String(token ?? "")).digest("hex");
}

export async function replaceAccountActionToken(connection, { userId, purpose, token, ttlMinutes }) {
  const tokenHash = hashAccountActionToken(token);
  await connection.query("DELETE FROM account_action_tokens WHERE user_id = ? AND purpose = ?", [userId, purpose]);
  await connection.query(
    "INSERT INTO account_action_tokens (user_id, purpose, token_hash, expires_at) VALUES (?, ?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? MINUTE))",
    [userId, purpose, tokenHash, ttlMinutes],
  );
}

export async function consumeAccountActionToken(connection, { token, purpose }) {
  const tokenHash = hashAccountActionToken(token);
  const [[row]] = await connection.query(
    `SELECT id, user_id FROM account_action_tokens
      WHERE token_hash = ? AND purpose = ? AND consumed_at IS NULL AND expires_at > UTC_TIMESTAMP()
      LIMIT 1 FOR UPDATE`,
    [tokenHash, purpose],
  );
  if (!row) return null;
  const [updated] = await connection.query(
    "UPDATE account_action_tokens SET consumed_at = UTC_TIMESTAMP() WHERE id = ? AND consumed_at IS NULL",
    [row.id],
  );
  return updated.affectedRows ? Number(row.user_id) : null;
}
