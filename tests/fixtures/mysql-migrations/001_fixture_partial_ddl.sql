CREATE TABLE IF NOT EXISTS fixture_ddl_first (
  id BIGINT UNSIGNED NOT NULL PRIMARY KEY
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS fixture_ddl_requires_dependency (
  id BIGINT UNSIGNED NOT NULL,
  dependency_id BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT fixture_ddl_dependency_fk FOREIGN KEY (dependency_id) REFERENCES fixture_ddl_dependency(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
