import { closePool, withTransaction } from "../server/db.js";
import { hashPassword, normalizeEmail } from "../server/security.js";

const email = normalizeEmail(process.env.ADMIN_EMAIL || "dr.loony91@gmail.com");
const password = process.env.TEST1_PASSWORD || "testtest1";

try {
  await withTransaction(async (connection) => {
    const passwordHash = await hashPassword(password);
    const [result] = await connection.query(
      "UPDATE users SET password_hash = ? WHERE email_key = ? AND role = 'admin'",
      [passwordHash, email],
    );
    if (result.affectedRows !== 1) throw new Error(`Не найден администратор ${email}`);
    await connection.query(
      "DELETE s FROM sessions s JOIN users u ON u.id = s.user_id WHERE u.email_key = ?",
      [email],
    );
  });
  console.log(`Пароль администратора ${email} обновлён`);
} finally {
  await closePool();
}
