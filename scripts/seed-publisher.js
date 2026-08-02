import { closePool, withTransaction } from "../server/db.js";
import { hashPassword, normalizeIdentity } from "../server/security.js";

const email = process.env.PUBLISHER_TEST_EMAIL || "publisher.test@bookmeet.kz";
const password = process.env.PUBLISHER_TEST_PASSWORD || "publisher2026";
const name = "Издательство «Тест»";
const books = [
  ["Айдана Сарсен", "Город между строк", "Роман о городе, памяти и встречах, которые меняют привычный маршрут.", "blue"],
  ["Марат Есенов", "Тёплый ветер степи", "Сборник рассказов о людях, дороге и современном Казахстане.", "sand"],
  ["Лейла Нур", "Свет в читальном зале", "История о библиотеке, которая становится точкой притяжения для целого района.", "mint"],
];

try {
  await withTransaction(async (connection) => {
    const passwordHash = await hashPassword(password);
    await connection.query(
      `INSERT INTO users (username, username_key, email, email_key, password_hash, initials, color, role, profile_completed)
       VALUES (?, ?, ?, ?, ?, 'ИТ', 'blue', 'user', 1)
       ON DUPLICATE KEY UPDATE username = VALUES(username), username_key = VALUES(username_key), initials = VALUES(initials), color = VALUES(color), profile_completed = 1`,
      [name, normalizeIdentity(name), email, email.toLowerCase(), passwordHash],
    );
    const [[user]] = await connection.query("SELECT id FROM users WHERE email_key = ?", [email.toLowerCase()]);
    await connection.query(
      `INSERT INTO profiles
        (user_id, display_name, city, profile_type, gender, bio, favorite_genres, disliked_genres,
         publisher_status, publisher_website, publisher_sales_links, publisher_legal_name, publisher_bin,
         publisher_account, publisher_bik, publisher_bank, publisher_legal_address, publisher_postal_address)
       VALUES (?, ?, '', 'Издатель', 'Не указан', ?, '[]', '[]', 'approved', ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), profile_type = 'Издатель', bio = VALUES(bio),
         publisher_status = 'approved', publisher_website = VALUES(publisher_website),
         publisher_sales_links = VALUES(publisher_sales_links), publisher_legal_name = VALUES(publisher_legal_name),
         publisher_bin = VALUES(publisher_bin), publisher_account = VALUES(publisher_account),
         publisher_bik = VALUES(publisher_bik), publisher_bank = VALUES(publisher_bank),
         publisher_legal_address = VALUES(publisher_legal_address), publisher_postal_address = VALUES(publisher_postal_address)`,
      [
        user.id, name,
        "Независимое казахстанское издательство современной прозы, нон-фикшна и красивых книг для вдумчивого чтения.",
        "https://bookmeet.kz", JSON.stringify([{ id: 1, label: "Flip", url: "https://www.flip.kz" }]),
        "ТОО «Тестовое издательство»", "240740000001", "KZ000000000000000001",
        "TESTKZKX", "Тестовый банк", "г. Астана, тестовый адрес, 1", "010000, г. Астана, а/я 1",
      ],
    );
    for (const [author, title, annotation, tone] of books) {
      const authorKey = normalizeIdentity(author);
      const titleKey = normalizeIdentity(title);
      await connection.query(
        `INSERT INTO books (creator_user_id, author, author_key, title, title_key, genres, annotation, cover_tone)
         VALUES (?, ?, ?, ?, ?, '[]', ?, ?)
         ON DUPLICATE KEY UPDATE annotation = VALUES(annotation), cover_tone = VALUES(cover_tone)`,
        [user.id, author, authorKey, title, titleKey, annotation, tone],
      );
      const [[book]] = await connection.query("SELECT id FROM books WHERE author_key = ? AND title_key = ? LIMIT 1", [authorKey, titleKey]);
      await connection.query(
        `INSERT INTO user_books (user_id, book_id, reading_status, is_author)
         VALUES (?, ?, 'read', 1)
         ON DUPLICATE KEY UPDATE is_author = 1`,
        [user.id, book.id],
      );
    }
    const [[city]] = await connection.query("SELECT id, name FROM cities WHERE name_key = ? LIMIT 1", [normalizeIdentity("Астана")]);
    if (city) {
      await connection.query(
        `INSERT INTO events (creator_user_id, title, summary, description, event_date, event_time, city, city_id, address, status)
         SELECT ?, ?, ?, ?, '2026-12-12', '18:30:00', ?, ?, ?, 'published'
         WHERE NOT EXISTS (SELECT 1 FROM events WHERE creator_user_id = ? AND title = ?)`,
        [user.id, "Встреча с авторами издательства «Тест»", "Разговор о новых казахстанских книгах и автограф-сессия.", "Познакомимся с авторами осенних новинок и обсудим, как рождаются современные книги.", city.name, city.id, "проспект Республики, 1", user.id, "Встреча с авторами издательства «Тест»"],
      );
    }
    await connection.query(
      `INSERT INTO publisher_news (user_id, title, preview_text, body_html, body)
       SELECT ?, ?, ?, ?, ?
       WHERE NOT EXISTS (SELECT 1 FROM publisher_news WHERE user_id = ? AND title = ?)`,
      [user.id, "Открыли предзаказ на осенние новинки", "Рассказываем о трёх книгах, которые выйдут этой осенью, и показываем первые обложки.", "<p>Рассказываем о трёх книгах, которые выйдут этой осенью, и показываем первые обложки.</p>", "Рассказываем о трёх книгах, которые выйдут этой осенью, и показываем первые обложки.", user.id, "Открыли предзаказ на осенние новинки"],
    );
  });
  console.log(`Тестовое издательство готово: ${email}`);
} finally {
  await closePool();
}
