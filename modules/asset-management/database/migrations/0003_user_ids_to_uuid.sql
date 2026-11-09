-- Id pengguna di tabel module aset menjadi uuid. Pasangan Core-nya adalah database/migrations/0003_user_ids_to_uuid.sql,
-- yang menjelaskan pemetaan dan alasannya. Kolom yang diubah dicari dari katalog dengan aturan yang sama, terbatas pada
-- tabel aset_.
--
-- Kolom bilangan bulat id pengguna di tabel aset_ hanya created_by_user_id dan updated_by_user_id, yang diisi trigger
-- function coreerp_stamp_audit_actor() milik Core. Di database hasil adopsi dump CoreERP, 0003 Core sudah mengubahnya
-- karena tipenya terikat ke function itu, jadi bagian ini tidak menemukan apa pun. Di database baru, 0001 module
-- membuatnya bigint sesudah 0003 Core berjalan, dan bagian ini yang mengubahnya menjadi uuid.
--
-- Kolom teks bernama *_user_id tetap varchar, karena CoreERP menerima teks apa pun sampai 64 karakter di sana dan baru
-- menampilkan nama bila teks itu id anggota tenant. Isinya yang berupa angka utuh ditulis ulang menjadi teks uuid.

-- Fungsi bantu di pg_temp hanya hidup selama migration ini dan dibuang di akhir berkas. Sama dengan fungsi bernama
-- sama di 0003 Core, yang membuangnya di akhir berkasnya.
CREATE FUNCTION pg_temp.user_id_text(value text) RETURNS text
    LANGUAGE sql IMMUTABLE STRICT
    AS $$
    SELECT CASE WHEN value ~ '^(0|[1-9][0-9]{0,17})$' THEN public.user_id_to_uuid(value::bigint)::text ELSE value END
$$;

DO $$
DECLARE
    target record;
BEGIN
    -- Satu ALTER TABLE per tabel. Tipe kolom teks tidak berubah; ALTER COLUMN TYPE menulis ulang isinya tanpa
    -- menjalankan trigger.
    FOR target IN
        SELECT c.oid::regclass AS table_name, string_agg(CASE
                WHEN a.atttypid IN ('int2'::regtype, 'int4'::regtype, 'int8'::regtype)
                    THEN format('ALTER COLUMN %I TYPE uuid USING public.user_id_to_uuid(%I)', a.attname, a.attname)
                ELSE format('ALTER COLUMN %I TYPE %s USING pg_temp.user_id_text(%I)',
                    a.attname, format_type(a.atttypid, a.atttypmod), a.attname)
            END, ', ' ORDER BY a.attnum) AS clauses
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
        WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname LIKE 'aset\_%'
          AND ((a.atttypid IN ('int2'::regtype, 'int4'::regtype, 'int8'::regtype)
                AND (a.attname = 'user_id' OR a.attname LIKE '%\_user\_id' OR a.attname LIKE '%\_by'))
            OR (a.atttypid IN ('text'::regtype, 'varchar'::regtype, 'bpchar'::regtype)
                AND (a.attname = 'user_id' OR a.attname LIKE '%\_user\_id')))
        GROUP BY c.oid ORDER BY 1
    LOOP
        EXECUTE format('ALTER TABLE %s %s', target.table_name, target.clauses);
        -- ALTER COLUMN TYPE membuang statistik kolom, sama seperti di 0003 Core.
        EXECUTE format('ANALYZE %s', target.table_name);
    END LOOP;
END $$;

DROP FUNCTION pg_temp.user_id_text(text);
