-- Mencari id pengguna di schema public: kolom menurut katalog, function yang membaca coreerp.user_id atau menyebut
-- kolom itu, lalu teks dan JSON yang menanam id pengguna. Jalankan dengan psql atas database yang mau diperiksa,
-- sebelum dan sesudah migration:
--   psql -X -v ON_ERROR_STOP=1 -f database/find-user-ids.sql
-- Sebelum migration, daftarnya menjadi bahan keputusan kolom mana yang dikonversi 0003 Core atau 0003 module
-- pemiliknya. Sesudah migration, kolom bertipe bigint dan nilai berupa angka tidak boleh tersisa.
--
-- Kolom id pengguna menurut katalog: users.id, kolom yang foreign key-nya menunjuk users(id), kolom bernama user_id
-- atau *_user_id apa pun tipenya, dan kolom bilangan bulat bernama *_by. Nama-nama kolom itu sekaligus menjadi kunci
-- yang dicari di JSON dan di change_log_entries.field_name, jadi aturan kuncinya ikut berasal dari katalog.

\pset footer off
\pset null '-'

CREATE TEMP TABLE user_id_column AS
SELECT c.oid AS relid, c.relname AS table_name, a.attnum, a.attname AS column_name,
    format_type(a.atttypid, a.atttypmod) AS column_type, a.atttypid AS type_id,
    (SELECT string_agg(con.conname, ', ' ORDER BY con.conname) FROM pg_constraint con
        WHERE con.contype = 'f' AND con.conrelid = c.oid AND con.confrelid = 'public.users'::regclass
          AND a.attnum = ANY (con.conkey)) AS foreign_key,
    CASE WHEN c.relname = 'users' AND a.attname = 'id' THEN 'users.id'
        WHEN EXISTS (SELECT 1 FROM pg_constraint con WHERE con.contype = 'f' AND con.conrelid = c.oid
            AND con.confrelid = 'public.users'::regclass AND a.attnum = ANY (con.conkey)) THEN 'foreign key'
        WHEN a.attname = 'user_id' OR a.attname LIKE '%\_user\_id' THEN 'name *_user_id'
        ELSE 'name *_by' END AS rule
FROM pg_attribute a
JOIN pg_class c ON c.oid = a.attrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped
  AND c.relname <> 'schema_migrations'
  AND ((c.relname = 'users' AND a.attname = 'id')
    OR a.attname = 'user_id' OR a.attname LIKE '%\_user\_id'
    OR (a.attname LIKE '%\_by' AND a.atttypid IN ('int2'::regtype, 'int4'::regtype, 'int8'::regtype))
    OR EXISTS (SELECT 1 FROM pg_constraint con WHERE con.contype = 'f' AND con.conrelid = c.oid
        AND con.confrelid = 'public.users'::regclass AND a.attnum = ANY (con.conkey)));

CREATE TEMP TABLE user_id_key AS SELECT DISTINCT column_name AS key FROM user_id_column WHERE column_name <> 'id';

\echo '== Kolom id pengguna per tipe dan aturan'
SELECT column_type, rule, count(*) AS columns, count(DISTINCT table_name) AS tables
FROM user_id_column GROUP BY 1, 2 ORDER BY 1, 2;

\echo '== Kolom id pengguna selain created_by_user_id dan updated_by_user_id'
SELECT table_name, column_name, column_type, rule, foreign_key
FROM user_id_column
WHERE column_name NOT IN ('created_by_user_id', 'updated_by_user_id')
ORDER BY table_name, column_name;

\echo '== Default dan sequence pada kolom id pengguna'
SELECT u.table_name, u.column_name, pg_get_expr(d.adbin, d.adrelid) AS column_default, a.attidentity AS identity
FROM user_id_column u
JOIN pg_attribute a ON a.attrelid = u.relid AND a.attnum = u.attnum
LEFT JOIN pg_attrdef d ON d.adrelid = u.relid AND d.adnum = u.attnum
WHERE d.oid IS NOT NULL OR a.attidentity <> ''
ORDER BY 1, 2;

\echo '== Function yang membaca coreerp.user_id atau menyebut users dan kolom id pengguna'
SELECT p.oid::regprocedure AS function_name,
    (SELECT string_agg(DISTINCT m[1], ', ') FROM regexp_matches(p.prosrc,
        '(coreerp\.user_id|::bigint|\mbigint\M|\musers\M|\m(?:' || (SELECT string_agg(key, '|') FROM user_id_key) || ')\M)', 'g') m) AS mentions,
    (SELECT count(*) FROM pg_trigger t WHERE t.tgfoid = p.oid AND NOT t.tgisinternal) AS triggers
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.prosrc ~ ('coreerp\.user_id|\musers\M|\m(?:' || (SELECT string_agg(key, '|') FROM user_id_key) || ')\M')
ORDER BY 1;

-- Isi kolom teks bernama *_user_id: berapa nilai berupa angka utuh, dan berapa yang memang id di users.
CREATE TEMP TABLE user_id_text_scan (column_name text, rows_with_value bigint, digit_values bigint, known_users bigint,
    shapes text);

SELECT format($scan$
    INSERT INTO user_id_text_scan
    SELECT %3$L, count(*), count(*) FILTER (WHERE v ~ '^[0-9]+$'),
        count(*) FILTER (WHERE v IN (SELECT id::text FROM public.users)),
        (SELECT string_agg(shape, ' ' ORDER BY shape) FROM (SELECT DISTINCT regexp_replace(left(%1$I::text, 40), '[0-9]', '#', 'g') AS shape
            FROM public.%2$I WHERE %1$I IS NOT NULL LIMIT 5) s)
    FROM (SELECT %1$I::text AS v FROM public.%2$I WHERE %1$I IS NOT NULL) t
$scan$, column_name, table_name, table_name || '.' || column_name)
FROM user_id_column
WHERE type_id IN ('text'::regtype, 'varchar'::regtype, 'bpchar'::regtype)
\gexec

\echo '== Kolom teks bernama *_user_id dan isinya'
SELECT * FROM user_id_text_scan ORDER BY column_name;

-- Kunci JSON yang namanya sama dengan kolom id pengguna, di semua kolom json dan jsonb.
CREATE TEMP TABLE user_id_json_scan (column_name text, path text, json_type text, values_found bigint,
    known_users bigint);

SELECT format($scan$
    WITH RECURSIVE walk(path, key, value) AS (
        SELECT '$', NULL::text, %1$I::jsonb FROM public.%2$I WHERE %1$I IS NOT NULL
        UNION ALL
        SELECT w.path || CASE WHEN e.key IS NULL THEN '[*]' ELSE '.' || e.key END, coalesce(e.key, w.key), e.value
        FROM walk w
        CROSS JOIN LATERAL (
            SELECT o.key, o.value FROM jsonb_each(CASE WHEN jsonb_typeof(w.value) = 'object' THEN w.value END) o
            UNION ALL
            SELECT NULL, x.value FROM jsonb_array_elements(CASE WHEN jsonb_typeof(w.value) = 'array' THEN w.value END) x
        ) e
    )
    INSERT INTO user_id_json_scan
    SELECT %3$L, path, jsonb_typeof(value), count(*),
        count(*) FILTER (WHERE value #>> '{}' IN (SELECT id::text FROM public.users))
    FROM walk WHERE key IN (SELECT key FROM user_id_key) AND jsonb_typeof(value) IN ('number', 'string')
    GROUP BY 2, 3
$scan$, a.attname, c.relname, c.relname || '.' || a.attname)
FROM pg_attribute a
JOIN pg_class c ON c.oid = a.attrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped
  AND a.atttypid IN ('json'::regtype, 'jsonb'::regtype)
\gexec

\echo '== Kunci JSON bernama kolom id pengguna'
SELECT * FROM user_id_json_scan ORDER BY column_name, path;

\echo '== Nilai change_log_entries untuk field id pengguna'
SELECT table_name, field_name, count(*) AS entries,
    count(*) FILTER (WHERE old_value ~ '^[0-9]+$' OR new_value ~ '^[0-9]+$') AS digit_values
FROM public.change_log_entries
WHERE field_name IN (SELECT key FROM user_id_key)
GROUP BY 1, 2 ORDER BY 1, 2;

\echo '== Teks lain di tabel yang memegang id pengguna, dengan bentuk nilainya (angka menjadi #)'
-- Kolom teks yang bukan id, di tabel yang punya kolom id pengguna selain stempel audit, dan isinya memuat angka yang
-- sama dengan id di users sebagai bagian utuh (diapit awal, akhir, atau tanda baca). Bahan untuk memutuskan teks
-- gabungan seperti actor_scope "system:1".
CREATE TEMP TABLE user_id_embedded_scan (column_name text, rows_with_user bigint, shapes text);

SELECT format($scan$
    INSERT INTO user_id_embedded_scan
    SELECT %3$L, count(*), string_agg(DISTINCT regexp_replace(left(v, 60), '[0-9]+', '#', 'g'), ' ')
    FROM (SELECT %1$I::text AS v FROM public.%2$I WHERE %1$I IS NOT NULL) t
    WHERE EXISTS (SELECT 1 FROM regexp_matches(v, '(?:^|[^0-9A-Za-z-])([0-9]+)(?:[^0-9A-Za-z-]|$)', 'g') m
        WHERE m[1] IN (SELECT id::text FROM public.users))
    HAVING count(*) > 0
$scan$, a.attname, c.relname, c.relname || '.' || a.attname)
FROM pg_attribute a
JOIN pg_class c ON c.oid = a.attrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped
  AND a.atttypid IN ('text'::regtype, 'varchar'::regtype, 'bpchar'::regtype)
  AND c.oid IN (SELECT relid FROM user_id_column WHERE column_name NOT IN ('created_by_user_id', 'updated_by_user_id'))
  AND NOT EXISTS (SELECT 1 FROM user_id_column u WHERE u.relid = c.oid AND u.attnum = a.attnum)
\gexec

SELECT * FROM user_id_embedded_scan ORDER BY column_name;
