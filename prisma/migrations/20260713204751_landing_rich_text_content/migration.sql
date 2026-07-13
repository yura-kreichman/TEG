-- Landing.aboutText и LandingZoneContent.caption: plain text -> ProseMirror/
-- Tiptap JSON (тот же формат, что Instruction.content) — решение пользователя
-- 2026-07-13, "тот же примитвный редактор, как и в инструкциях".
--
-- Ручная миграция (не автосгенерированный ALTER COLUMN ... USING ...::jsonb)
-- намеренно: существующий текст НЕ является валидным JSON, автокаст уронил
-- бы миграцию на любой заполненной строке. Вместо этого — временные колонки
-- + оборачивание каждой непустой строки в { doc > paragraph > text/hardBreak }
-- (перенос строки внутри исходного текста -> hardBreak, ProseMirror не
-- допускает буквальный \n внутри text-узла), затем drop+rename. Протестировано
-- на реальных локальных данных (KidsBurg) перед применением.

ALTER TABLE "Landing" ADD COLUMN "aboutTextTmp" JSONB;
ALTER TABLE "LandingZoneContent" ADD COLUMN "captionTmp" JSONB;

WITH src AS (
  SELECT id, "aboutText" AS txt FROM "Landing" WHERE "aboutText" IS NOT NULL AND trim("aboutText") <> ''
),
lines AS (
  SELECT id, ord, line FROM src, unnest(regexp_split_to_array(txt, E'\n')) WITH ORDINALITY AS u(line, ord)
),
elems AS (
  SELECT id, (ord * 2 - 1) AS seq, jsonb_build_object('type', 'hardBreak') AS elem FROM lines WHERE ord > 1
  UNION ALL
  SELECT id, (ord * 2) AS seq, jsonb_build_object('type', 'text', 'text', line) AS elem FROM lines WHERE trim(line) <> ''
)
UPDATE "Landing" l
SET "aboutTextTmp" = jsonb_build_object(
  'type', 'doc',
  'content', jsonb_build_array(
    jsonb_build_object('type', 'paragraph', 'content', (SELECT jsonb_agg(elem ORDER BY seq) FROM elems e WHERE e.id = l.id))
  )
)
FROM src
WHERE l.id = src.id;

WITH src AS (
  SELECT id, caption AS txt FROM "LandingZoneContent" WHERE caption IS NOT NULL AND trim(caption) <> ''
),
lines AS (
  SELECT id, ord, line FROM src, unnest(regexp_split_to_array(txt, E'\n')) WITH ORDINALITY AS u(line, ord)
),
elems AS (
  SELECT id, (ord * 2 - 1) AS seq, jsonb_build_object('type', 'hardBreak') AS elem FROM lines WHERE ord > 1
  UNION ALL
  SELECT id, (ord * 2) AS seq, jsonb_build_object('type', 'text', 'text', line) AS elem FROM lines WHERE trim(line) <> ''
)
UPDATE "LandingZoneContent" z
SET "captionTmp" = jsonb_build_object(
  'type', 'doc',
  'content', jsonb_build_array(
    jsonb_build_object('type', 'paragraph', 'content', (SELECT jsonb_agg(elem ORDER BY seq) FROM elems e WHERE e.id = z.id))
  )
)
FROM src
WHERE z.id = src.id;

ALTER TABLE "Landing" DROP COLUMN "aboutText";
ALTER TABLE "Landing" RENAME COLUMN "aboutTextTmp" TO "aboutText";

ALTER TABLE "LandingZoneContent" DROP COLUMN "caption";
ALTER TABLE "LandingZoneContent" RENAME COLUMN "captionTmp" TO "caption";
