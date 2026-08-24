import { closePool, withTransaction } from "../server/db.js";
import { hashPassword, normalizeIdentity } from "../server/security.js";

const production = process.env.NODE_ENV === "production";
const configuredAdminEmail = process.env.ADMIN_EMAIL?.trim();
const configuredTest1Password = process.env.TEST1_PASSWORD;
const hasConfiguredTest1Password = typeof configuredTest1Password === "string" && configuredTest1Password.trim().length > 0;

if (production && (!configuredAdminEmail || !hasConfiguredTest1Password)) {
  throw new Error("В production seed требует явные ADMIN_EMAIL и TEST1_PASSWORD");
}

const adminEmail = production ? configuredAdminEmail : configuredAdminEmail || "admin@example.com";
const test1Password = production ? configuredTest1Password : configuredTest1Password || "change-me-locally";

const accounts = [
  {
    username: "Тест 1",
    email: adminEmail,
    role: "admin",
    password: test1Password,
    initials: "Т1",
    color: "mint",
    profile: {
      name: "Тест 1", city: "Астана", type: "Читатель",
      bio: "", authorInfluences: "", writingThemes: "", weekend: "", joy: "", talk: "", strangerMessage: "",
      favoriteGenres: [], dislikedGenres: [],
    },
  },
];

try {
  await withTransaction(async (connection) => {
    for (const account of accounts) {
      const passwordHash = await hashPassword(account.password);
      await connection.query(
        `INSERT INTO users (username, username_key, email, email_key, password_hash, initials, color, role, profile_completed)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
         ON DUPLICATE KEY UPDATE username = VALUES(username), email = VALUES(email), email_key = VALUES(email_key), password_hash = VALUES(password_hash), initials = VALUES(initials), color = VALUES(color), role = VALUES(role), profile_completed = 1`,
        [account.username, normalizeIdentity(account.username), account.email, normalizeIdentity(account.email), passwordHash, account.initials, account.color, account.role],
      );
      const [[user]] = await connection.query("SELECT id FROM users WHERE username_key = ?", [normalizeIdentity(account.username)]);
      const profile = account.profile;
      await connection.query(
        `INSERT INTO profiles (user_id, display_name, city, profile_type, bio, author_influences, writing_themes, weekend, joy, talk, stranger_message, favorite_genres, disliked_genres)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), city = VALUES(city), profile_type = VALUES(profile_type), bio = VALUES(bio), author_influences = VALUES(author_influences), writing_themes = VALUES(writing_themes)`,
        [user.id, profile.name, profile.city, profile.type, profile.bio, profile.authorInfluences, profile.writingThemes, profile.weekend, profile.joy, profile.talk, profile.strangerMessage, JSON.stringify(profile.favoriteGenres), JSON.stringify(profile.dislikedGenres)],
      );
    }
  });
  console.log(`Создан администратор Book Meet: ${adminEmail}`);
} finally {
  await closePool();
}
