CREATE TABLE IF NOT EXISTS city_aliases (
  city_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(180) NOT NULL,
  name_key VARCHAR(180) NOT NULL,
  language_code CHAR(2) NOT NULL,
  PRIMARY KEY (city_id, language_code, name_key),
  KEY city_aliases_name_key_idx (name_key),
  CONSTRAINT city_aliases_city_fk FOREIGN KEY (city_id) REFERENCES cities(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Canonical corrections for the mixed or obsolete GeoNames spellings found in production.
UPDATE cities SET name = 'Актобе', name_key = 'актобе', country_code = 'KZ', country_name = 'Казахстан' WHERE geoname_id = 610611;
UPDATE cities SET name = 'Жезказган', name_key = 'жезказган', country_code = 'KZ', country_name = 'Казахстан' WHERE geoname_id = 1516589;
UPDATE cities SET name = 'Туркестан', name_key = 'туркестан', country_code = 'KZ', country_name = 'Казахстан' WHERE geoname_id = 1517945;
UPDATE cities SET name = 'Уральск', name_key = 'уральск', country_code = 'KZ', country_name = 'Казахстан' WHERE geoname_id = 608668;
UPDATE cities SET name = 'Петропавловск', name_key = 'петропавловск', country_code = 'KZ', country_name = 'Казахстан' WHERE geoname_id = 1520172;
UPDATE cities SET name = 'Балхаш', name_key = 'балхаш', country_code = 'KZ', country_name = 'Казахстан' WHERE geoname_id = 1525798;
UPDATE cities SET name = 'Кульсары', name_key = 'кульсары', country_code = 'KZ', country_name = 'Казахстан' WHERE geoname_id = 609123;
UPDATE cities SET name = 'Аксай', name_key = 'аксай', country_code = 'KZ', country_name = 'Казахстан' WHERE geoname_id = 610613;

INSERT IGNORE INTO city_aliases (city_id, name, name_key, language_code)
SELECT id, alias_name, alias_key, language_code
FROM cities
JOIN (
  SELECT 610611 geoname_id, 'Ақтөбе' alias_name, 'ақтөбе' alias_key, 'kk' language_code UNION ALL
  SELECT 1516589, 'Жезқазған', 'жезқазған', 'kk' UNION ALL
  SELECT 1517945, 'Түркістан', 'түркістан', 'kk' UNION ALL
  SELECT 608668, 'Орал', 'орал', 'kk' UNION ALL
  SELECT 1520172, 'Петропавл', 'петропавл', 'kk' UNION ALL
  SELECT 1525798, 'Балқаш', 'балқаш', 'kk' UNION ALL
  SELECT 609123, 'Құлсары', 'құлсары', 'kk' UNION ALL
  SELECT 610613, 'Ақсай', 'ақсай', 'kk' UNION ALL
  SELECT 1520316, 'Өскемен', 'өскемен', 'kk' UNION ALL
  SELECT 1518262, 'Теміртау', 'теміртау', 'kk' UNION ALL
  SELECT 1522203, 'Көкшетау', 'көкшетау', 'kk' UNION ALL
  SELECT 610612, 'Ақтау', 'ақтау', 'kk' UNION ALL
  SELECT 1524325, 'Екібастұз', 'екібастұз', 'kk' UNION ALL
  SELECT 1518542, 'Талдықорған', 'талдықорған', 'kk' UNION ALL
  SELECT 607610, 'Жаңаөзен', 'жаңаөзен', 'kk' UNION ALL
  SELECT 1520692, 'Сәтбаев', 'сәтбаев', 'kk' UNION ALL
  SELECT 1522751, 'Кентау', 'кентау', 'kk' UNION ALL
  SELECT 1519244, 'Щучинск', 'щучинск', 'kk' UNION ALL
  SELECT 1524298, 'Ақсу', 'ақсу', 'kk' UNION ALL
  SELECT 1519725, 'Саран', 'саран', 'kk' UNION ALL
  SELECT 1519948, 'Қонаев', 'қонаев', 'kk' UNION ALL
  SELECT 1526193, 'Арқалық', 'арқалық', 'kk' UNION ALL
  SELECT 1519030, 'Шу', 'шу', 'kk' UNION ALL
  SELECT 1524385, 'Жетісай', 'жетісай', 'kk' UNION ALL
  SELECT 1526168, 'Арыс', 'арыс', 'kk' UNION ALL
  SELECT 1526970, 'Абай', 'абай', 'kk' UNION ALL
  SELECT 1520253, 'Жаркент', 'жаркент', 'kk' UNION ALL
  SELECT 1516788, 'Жаңатас', 'жаңатас', 'kk' UNION ALL
  SELECT 1525988, 'Аягөз', 'аягөз', 'kk' UNION ALL
  SELECT 1526265, 'Арал', 'арал', 'kk' UNION ALL
  SELECT 1523741, 'Есік', 'есік', 'kk' UNION ALL
  SELECT 608679, 'Қандыағаш', 'қандыағаш', 'kk' UNION ALL
  SELECT 608359, 'Шалқар', 'шалқар', 'kk' UNION ALL
  SELECT 1524889, 'Шардара', 'шардара', 'kk' UNION ALL
  SELECT 1519673, 'Сарыағаш', 'сарыағаш', 'kk' UNION ALL
  SELECT 609404, 'Хромтау', 'хромтау', 'kk' UNION ALL
  SELECT 1517637, 'Үштөбе', 'үштөбе', 'kk' UNION ALL
  SELECT 1526797, 'Ақкөл', 'ақкөл', 'kk' UNION ALL
  SELECT 1519935, 'Қаражал', 'қаражал', 'kk' UNION ALL
  SELECT 1524296, 'Есіл', 'есіл', 'kk' UNION ALL
  SELECT 1517060, 'Зайсан', 'зайсан', 'kk' UNION ALL
  SELECT 1520885, 'Курчатов', 'курчатов', 'kk'
) aliases USING (geoname_id)
WHERE cities.country_code = 'KZ';

-- Every Kazakhstan locality is represented in both language indexes. When the
-- spelling is shared, DISTINCT in the API returns one visible option; translated
-- aliases above remain separate Russian and Kazakh choices.
INSERT IGNORE INTO city_aliases (city_id, name, name_key, language_code)
SELECT id, name, name_key, 'ru' FROM cities WHERE country_code = 'KZ';

INSERT IGNORE INTO city_aliases (city_id, name, name_key, language_code)
SELECT id, name, name_key, 'kk' FROM cities WHERE country_code = 'KZ';

-- Explicit Russian aliases for records whose canonical GeoNames name is Kazakh.
INSERT IGNORE INTO city_aliases (city_id, name, name_key, language_code)
SELECT id, alias_name, alias_key, 'ru'
FROM cities
JOIN (
  SELECT 1519691 geoname_id, 'Сарканд' alias_name, 'сарканд' alias_key UNION ALL
  SELECT 609123, 'Кульсары', 'кульсары' UNION ALL
  SELECT 610613, 'Аксай', 'аксай' UNION ALL
  SELECT 1517323, 'Жанакорган', 'жанакорган' UNION ALL
  SELECT 1526041, 'Жанаарка', 'жанаарка' UNION ALL
  SELECT 1521126, 'Маканчи', 'маканчи' UNION ALL
  SELECT 608872, 'Макат', 'макат' UNION ALL
  SELECT 1519932, 'Качар', 'качар'
) aliases USING (geoname_id)
WHERE cities.country_code = 'KZ';
