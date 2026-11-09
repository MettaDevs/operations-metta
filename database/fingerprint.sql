-- Sidik jari isi setiap tabel di schema public: jumlah baris dan md5 seluruh baris, dengan setiap id ditulis sebagai
-- ULID huruf besar. Jalankan sebelum dan sesudah 0002 pada database yang sama, lalu bandingkan:
--   psql -X -v ON_ERROR_STOP=1 -f database/fingerprint.sql > sebelum.txt
--   psql -X -v ON_ERROR_STOP=1 -f database/fingerprint.sql > sesudah.txt
--   diff sebelum.txt sesudah.txt
-- Kedua hasil harus sama persis. Uuid diterjemahkan balik dengan aritmetika numeric milik berkas ini sendiri, bukan
-- dengan fungsi dari migration, jadi pemetaan yang salah tetap ketahuan walaupun ia konsisten dengan kebalikannya.
-- finance_postings.input_hash tidak ikut dihitung karena 0002 sengaja menghitungnya ulang atas id uuid.

\pset footer off
\pset format unaligned
\pset tuples_only on

CREATE FUNCTION pg_temp.fingerprint_ulid(id uuid) RETURNS text
    LANGUAGE plpgsql IMMUTABLE STRICT
    AS $$
DECLARE
    hex CONSTANT text := replace(id::text, '-', '');
    value numeric := 0;
    ulid text := '';
BEGIN
    FOR i IN 1..32 LOOP
        value := value * 16 + strpos('0123456789abcdef', substr(hex, i, 1)) - 1;
    END LOOP;
    FOR i IN 1..26 LOOP
        ulid := substr('0123456789ABCDEFGHJKMNPQRSTVWXYZ', (value % 32)::integer + 1, 1) || ulid;
        value := div(value, 32);
    END LOOP;
    RETURN ulid;
END $$;

-- Teks uuid diterjemahkan menjadi ULID dan setiap ULID dijadikan huruf besar, sehingga teks yang hanya berubah
-- bentuk id-nya menghasilkan nilai yang sama sebelum dan sesudah konversi.
CREATE FUNCTION pg_temp.fingerprint_text(value text) RETURNS text
    LANGUAGE plpgsql IMMUTABLE STRICT
    AS $$
DECLARE
    rendered text := value;
    token text;
BEGIN
    FOR token IN
        SELECT DISTINCT m[1] FROM regexp_matches(value, '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})', 'g') m
    LOOP
        rendered := replace(rendered, token, pg_temp.fingerprint_ulid(token::uuid));
    END LOOP;
    FOR token IN
        SELECT DISTINCT m[1]
        FROM regexp_matches(rendered, '(?<![0-9A-Za-z])([0-7][0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{25})(?![0-9A-Za-z])', 'g') m
    LOOP
        rendered := replace(rendered, token, upper(token));
    END LOOP;
    RETURN rendered;
END $$;

SELECT format(
    'SELECT %L, count(*), md5(coalesce(string_agg(r, E''\n'' ORDER BY r COLLATE "C"), '''')) FROM (SELECT concat_ws(chr(31), %s) AS r FROM public.%I) s',
    c.relname,
    string_agg(format('coalesce(%s, ''\N'')', CASE
        WHEN c.relname = 'finance_postings' AND a.attname = 'input_hash' THEN quote_literal('dihitung ulang')
        WHEN a.atttypid = 'uuid'::regtype THEN format('pg_temp.fingerprint_ulid(%I)', a.attname)
        WHEN a.atttypid IN ('text'::regtype, 'varchar'::regtype, 'bpchar'::regtype, 'json'::regtype, 'jsonb'::regtype)
            THEN format('pg_temp.fingerprint_text(%I::text)', a.attname)
        ELSE format('%I::text', a.attname) END), ', ' ORDER BY a.attnum),
    c.relname)
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname <> 'schema_migrations'
GROUP BY c.relname
ORDER BY c.relname
\gexec
