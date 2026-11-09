-- Mencari ULID yang tertanam di kolom teks dan JSON pada schema public.
-- Jalankan dengan psql atas dump CoreERP yang sudah dipulihkan, sebelum dan sesudah migration:
--   psql -X -v ON_ERROR_STOP=1 -f database/find-ulid-text.sql
-- Sebelum migration, daftarnya menjadi bahan keputusan kolom mana yang ditulis ulang 0002 Core atau 0002 module
-- pemiliknya.
-- Sesudah migration, yang masih muncul hanya boleh kolom yang sengaja dibiarkan.
-- Token dihitung hanya bila tidak diapit huruf atau angka lain, supaya potongan hash tidak ikut terbaca.
-- Kolom known menghitung token yang memang id di database ini, sebagai pembeda dari kebetulan.

\pset footer off
\pset null '-'

CREATE TEMP TABLE ulid_scan_known (ulid text PRIMARY KEY);

SELECT format(
    'INSERT INTO ulid_scan_known SELECT DISTINCT %s FROM public.%I WHERE %I IS NOT NULL ON CONFLICT DO NOTHING',
    CASE WHEN a.atttypid = 'uuid'::regtype THEN format('public.uuid_to_ulid(%I)', a.attname)
        ELSE format('upper(%I)', a.attname) END,
    c.relname, a.attname)
FROM pg_attribute a
JOIN pg_class c ON c.oid = a.attrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped
  AND ((a.atttypid = 'bpchar'::regtype AND a.atttypmod = 30)
    OR (a.atttypid = 'uuid'::regtype AND to_regprocedure('public.uuid_to_ulid(uuid)') IS NOT NULL))
\gexec

CREATE TEMP TABLE ulid_scan_result (
    column_name text,
    location text,
    rows_with_ulid bigint,
    distinct_ulids bigint,
    known_ids bigint
);

SELECT format($scan$
    WITH token AS (
        SELECT s.v, m[1] AS ulid
        FROM (SELECT %1$I::text AS v FROM public.%2$I WHERE %1$I IS NOT NULL) s
        CROSS JOIN LATERAL regexp_matches(s.v, '(?<![0-9A-Za-z])([0-7][0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{25})(?![0-9A-Za-z])', 'g') m
    )
    INSERT INTO ulid_scan_result
    SELECT %3$L,
        left(regexp_replace(v, '(?<![0-9A-Za-z])[0-7][0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{25}(?![0-9A-Za-z])', '<ULID>', 'g'), 100),
        count(DISTINCT v), count(DISTINCT upper(ulid)),
        count(DISTINCT upper(ulid)) FILTER (WHERE upper(ulid) IN (SELECT k.ulid FROM ulid_scan_known k))
    FROM token GROUP BY 2
$scan$, a.attname, c.relname, c.relname || '.' || a.attname)
FROM pg_attribute a
JOIN pg_class c ON c.oid = a.attrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped
  AND a.atttypid IN ('text'::regtype, 'varchar'::regtype, 'bpchar'::regtype)
  AND NOT (a.atttypid = 'bpchar'::regtype AND a.atttypmod = 30)
\gexec

SELECT format($scan$
    WITH RECURSIVE walk(path, value) AS (
        SELECT '$', %1$I::jsonb FROM public.%2$I WHERE %1$I IS NOT NULL
        UNION ALL
        SELECT w.path || CASE WHEN e.key IS NULL THEN '[*]'
                WHEN e.key ~ '^[0-7][0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{25}$' THEN '.<ULID>'
                ELSE '.' || e.key END,
            e.value
        FROM walk w
        CROSS JOIN LATERAL (
            SELECT o.key, o.value FROM jsonb_each(CASE WHEN jsonb_typeof(w.value) = 'object' THEN w.value END) o
            UNION ALL
            SELECT NULL, x.value FROM jsonb_array_elements(CASE WHEN jsonb_typeof(w.value) = 'array' THEN w.value END) x
        ) e
    ),
    token AS (
        SELECT w.path, w.value #>> '{}' AS v, m[1] AS ulid
        FROM walk w
        CROSS JOIN LATERAL regexp_matches(w.value #>> '{}', '(?<![0-9A-Za-z])([0-7][0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{25})(?![0-9A-Za-z])', 'g') m
        WHERE jsonb_typeof(w.value) = 'string'
        UNION ALL
        SELECT w.path, NULL, k.key
        FROM walk w
        CROSS JOIN LATERAL jsonb_object_keys(CASE WHEN jsonb_typeof(w.value) = 'object' THEN w.value END) k(key)
        WHERE k.key ~ '^[0-7][0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{25}$'
    )
    INSERT INTO ulid_scan_result
    SELECT %3$L,
        path || CASE WHEN v IS NULL THEN ' (key)'
            WHEN v ~ '^[0-7][0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{25}$' THEN ''
            ELSE ' ~ ' || left(regexp_replace(v, '(?<![0-9A-Za-z])[0-7][0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{25}(?![0-9A-Za-z])', '<ULID>', 'g'), 60) END,
        count(*), count(DISTINCT upper(ulid)),
        count(DISTINCT upper(ulid)) FILTER (WHERE upper(ulid) IN (SELECT k.ulid FROM ulid_scan_known k))
    FROM token GROUP BY 2
$scan$, a.attname, c.relname, c.relname || '.' || a.attname)
FROM pg_attribute a
JOIN pg_class c ON c.oid = a.attrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped
  AND a.atttypid IN ('json'::regtype, 'jsonb'::regtype)
\gexec

SELECT column_name, location, rows_with_ulid, distinct_ulids, known_ids
FROM ulid_scan_result
ORDER BY column_name, rows_with_ulid DESC, location;
