-- Точечные исправления найденных ошибок русскоязычного справочника GeoNames.
UPDATE cities
   SET name = 'Тюмень', name_key = 'тюмень', country_code = 'RU', country_name = 'Россия'
 WHERE geoname_id = 1488754;

UPDATE cities
   SET name = 'Москва', name_key = 'москва', country_code = 'RU', country_name = 'Россия'
 WHERE geoname_id = 524901;

DELETE FROM cities
 WHERE geoname_id = 1220988
   AND name = 'Москва'
   AND country_code = 'TJ';
