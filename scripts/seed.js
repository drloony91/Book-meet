import { closePool, getPool, withTransaction } from "../server/db.js";
import { hashPassword, normalizeIdentity } from "../server/security.js";

const accounts = [
  {
    username: "Тест 1",
    email: "dr.loony91@gmail.com",
    role: "admin",
    password: process.env.TEST1_PASSWORD || "testtest1",
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
        [account.username, normalizeIdentity(account.username), account.email, account.email, passwordHash, account.initials, account.color, account.role],
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
  console.log("Создан администратор Book Meet: dr.loony91@gmail.com");
} finally {
  await closePool();
}
