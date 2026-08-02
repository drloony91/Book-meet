ALTER TABLE excerpts
  ADD COLUMN preview_text TEXT NULL AFTER book_title,
  ADD COLUMN body_html LONGTEXT NULL AFTER preview_text;

UPDATE excerpts
   SET preview_text = COALESCE(preview_text, LEFT(body, 500)),
       body_html = COALESCE(body_html, '');
