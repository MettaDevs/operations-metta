-- Id pengguna menjadi uuid. Keputusan pemilik produk 9 November 2026: identitas pengguna pindah ke
-- control-plane-metta, yang memberi setiap pengguna id uuid seperti Microsoft Entra ID, sedangkan repo ini memegang
-- role dan izin per lingkungan dan merujuk pengguna lewat id itu. Setiap id lain sudah uuid sejak 0002, jadi users.id
-- dan semua kolom yang memegang id pengguna diubah sekarang, sebelum lebih banyak tabel merujuk users.
--
-- Pemetaan: id n menjadi uuid yang nilai 128 bitnya n, yaitu 64 bit atas nol dan n di 64 bit bawah, misalnya 12
-- menjadi 00000000-0000-0000-0000-00000000000c. Nilainya tetap dan hanya bentuk teksnya yang berubah, sama dengan
-- keputusan ULID di 0002. Pemetaan ini bisa dibalik dengan uuid_to_user_id, menjaga urutan, dan tidak bertabrakan
-- dengan uuid v7 pengguna baru, yang 48 bit pertamanya berisi waktu. parity/ids.py memakai rumus yang sama. Pengguna
-- baru mendapat id dari Bun.randomUUIDv7() seperti id lain, jadi users.id kehilangan sequence-nya.
--
-- Kolom id pengguna mengikuti aturan database/find-user-ids.sql: users.id, kolom yang foreign key-nya menunjuk
-- users(id), kolom bernama user_id atau *_user_id, dan kolom bilangan bulat bernama *_by. Kolom bilangan bulat berubah
-- tipe menjadi uuid. Kolom teks tetap teks, dan isinya yang berupa angka utuh ditulis ulang menjadi teks uuid.
--
-- Berkas ini mengubah kolom milik Core, ditambah dua jenis kolom tabel module yang tipenya terikat ke Core, bila
-- tabelnya sudah ada, yaitu di database hasil adopsi dump CoreERP. Alasannya sama dengan foreign key module di 0002:
--   - Kolom yang foreign key-nya menunjuk users(id) harus berubah tipe bersama users.id. Dump CoreERP 6b3cf584 belum
--     punya foreign key module ke users.
--   - created_by_user_id dan updated_by_user_id diisi trigger function coreerp_stamp_audit_actor() milik Core, yang di
--     berkas ini mulai menulis uuid. Tabel module yang tertinggal bigint akan menolak setiap tulisan begitu Core
--     dimigrasi tanpa module-nya, misalnya dengan --modules ''. Di dump itu, keduanya satu-satunya kolom bilangan bulat
--     id pengguna di tabel module.
-- Di database baru, tabel module belum ada saat berkas ini berjalan, dan migration module mengubahnya sendiri. Kolom
-- teks id pengguna milik module ditulis ulang migration module pemiliknya.
--
-- Yang ditemukan tetapi sengaja tidak ditulis ulang:
--   - sessions.payload. Sesi dari sebelum migration ini masih memegang id angka, dan aplikasi membacanya sebagai belum
--     login, sama seperti id ULID lama di workspace sesi. Sesi di Valkey tidak terjangkau migration, jadi aturannya ada
--     di aplikasi.
--   - tenant_creation_requests.request_hash, hash atas permintaan pembuatan tenant termasuk id principal. Input
--     lengkapnya tidak tersimpan, dan tidak ada kode di repo ini yang membacanya.
--   - Payload jobs dan failed_jobs, job PHP berserial yang tidak dijalankan apa pun di repo ini.

CREATE FUNCTION public.user_id_to_uuid(id bigint) RETURNS uuid
    LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE
    AS $$
BEGIN
    IF id < 0 THEN
        RAISE EXCEPTION 'Id pengguna negatif: %', id USING ERRCODE = 'numeric_value_out_of_range';
    END IF;
    RETURN lpad(to_hex(id), 32, '0')::uuid;
END $$;

CREATE FUNCTION public.uuid_to_user_id(id uuid) RETURNS bigint
    LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE
    AS $$
DECLARE
    hex CONSTANT text := replace(id::text, '-', '');
BEGIN
    -- Hanya uuid keluaran user_id_to_uuid: 64 bit atas nol, dan bit tanda bigint di 64 bit bawah juga nol.
    IF hex !~ '^0{16}[0-7]' THEN
        RAISE EXCEPTION 'Bukan id pengguna hasil konversi: "%"', id USING ERRCODE = 'invalid_text_representation';
    END IF;
    RETURN ('x' || right(hex, 16))::bit(64)::bigint;
END $$;

-- Fungsi bantu di pg_temp hanya hidup selama migration ini dan dibuang di akhir berkas.

-- Kunci yang memegang id pengguna di JSON dan di change_log_entries.field_name, sama dengan parity/ids.py:
-- user_id, *_user_id, dan nama kolom id pengguna di katalog yang tidak berpola itu.
CREATE FUNCTION pg_temp.user_id_key(key text) RETURNS boolean
    LANGUAGE sql IMMUTABLE STRICT
    AS $$
    SELECT lower(key) = 'user_id' OR lower(key) LIKE '%\_user\_id'
        OR lower(key) IN ('created_by', 'updated_by', 'requested_by', 'sso_redeemed_by', 'principal_id')
$$;

-- Angka utuh tanpa nol di depan, paling banyak 18 digit sehingga selalu muat di bigint.
CREATE FUNCTION pg_temp.user_id_text(value text) RETURNS text
    LANGUAGE sql IMMUTABLE STRICT
    AS $$
    SELECT CASE WHEN value ~ '^(0|[1-9][0-9]{0,17})$' THEN public.user_id_to_uuid(value::bigint)::text ELSE value END
$$;

-- Bagian yang utuh berupa angka diganti, pemisah dan bagian lain tetap, misalnya "system:1".
CREATE FUNCTION pg_temp.user_id_parts(value text, separators text) RETURNS text
    LANGUAGE sql IMMUTABLE STRICT
    AS $$
    SELECT coalesce(string_agg(pg_temp.user_id_text(m.part[1]), '' ORDER BY m.n), value)
    FROM regexp_matches(value, '[^' || separators || ']+|[' || separators || ']', 'g') WITH ORDINALITY AS m(part, n)
$$;

-- Angka atau teks angka di bawah kunci id pengguna menjadi string uuid, di kedalaman berapa pun. Elemen array memakai
-- kunci induknya.
CREATE FUNCTION pg_temp.user_ids_in_json(document jsonb, parent_key text) RETURNS jsonb
    LANGUAGE plpgsql IMMUTABLE
    AS $$
BEGIN
    CASE jsonb_typeof(document)
        WHEN 'object' THEN
            RETURN (SELECT coalesce(jsonb_object_agg(e.key, pg_temp.user_ids_in_json(e.value, e.key)), '{}'::jsonb)
                FROM jsonb_each(document) e);
        WHEN 'array' THEN
            RETURN (SELECT coalesce(jsonb_agg(pg_temp.user_ids_in_json(e.value, parent_key) ORDER BY e.n), '[]'::jsonb)
                FROM jsonb_array_elements(document) WITH ORDINALITY AS e(value, n));
        ELSE
            IF pg_temp.user_id_key(parent_key) AND jsonb_typeof(document) IN ('number', 'string')
                AND document #>> '{}' ~ '^(0|[1-9][0-9]{0,17})$' THEN
                RETURN to_jsonb(public.user_id_to_uuid((document #>> '{}')::bigint)::text);
            END IF;
            RETURN document;
    END CASE;
END $$;

-- users.id dibuat aplikasi, tidak lagi oleh sequence.
ALTER TABLE public.users ALTER COLUMN id DROP DEFAULT;
DROP SEQUENCE public.users_id_seq;

DO $$
DECLARE
    target record;
    dependent record;
    restore text[] := '{}';
    statement text;
    unexpected text;
BEGIN
    CREATE TEMP TABLE user_id_conversion (relid oid, attnum smallint, PRIMARY KEY (relid, attnum)) ON COMMIT DROP;

    -- users.id, kolom yang foreign key-nya menunjuk users(id), dan kolom yang diisi coreerp_stamp_audit_actor(), di
    -- tabel mana pun.
    INSERT INTO user_id_conversion
    SELECT a.attrelid, a.attnum FROM pg_attribute a WHERE a.attrelid = 'public.users'::regclass AND a.attname = 'id'
    UNION
    SELECT con.conrelid, key.attnum
    FROM pg_constraint con CROSS JOIN LATERAL unnest(con.conkey) AS key(attnum)
    WHERE con.contype = 'f' AND con.confrelid = 'public.users'::regclass
    UNION
    SELECT a.attrelid, a.attnum
    FROM pg_trigger t
    JOIN pg_attribute a ON a.attrelid = t.tgrelid AND a.attname IN ('created_by_user_id', 'updated_by_user_id')
        AND NOT a.attisdropped
    WHERE t.tgfoid = 'public.coreerp_stamp_audit_actor()'::regprocedure AND NOT t.tgisinternal;

    -- Kolom bilangan bulat id pengguna milik Core yang tidak terikat foreign key maupun stempel.
    FOR target IN
        SELECT t.relname, t.attname, a.attrelid, a.attnum
        FROM (VALUES
            ('analytics_dashboards', 'user_id'),
            ('analytics_saved_queries', 'user_id'),
            ('finance_posting_events', 'user_id'),
            ('integration_clients', 'user_id'),
            ('invitation_codes', 'sso_redeemed_by'),
            ('report_exports', 'user_id'),
            ('report_last_used_options', 'user_id'),
            ('report_presets', 'user_id'),
            ('sessions', 'user_id')
        ) AS t(relname, attname)
        LEFT JOIN pg_attribute a
            ON a.attrelid = to_regclass(format('public.%I', t.relname)) AND a.attname = t.attname AND NOT a.attisdropped
    LOOP
        IF target.attnum IS NULL THEN
            RAISE EXCEPTION 'Kolom %.% tidak ada; daftar kolom di 0003 perlu diperbarui.', target.relname, target.attname;
        END IF;
        INSERT INTO user_id_conversion VALUES (target.attrelid, target.attnum) ON CONFLICT DO NOTHING;
    END LOOP;

    SELECT string_agg(format('%s.%I %s', c.relid::regclass, a.attname, format_type(a.atttypid, a.atttypmod)), ', ')
    INTO unexpected
    FROM user_id_conversion c JOIN pg_attribute a ON a.attrelid = c.relid AND a.attnum = c.attnum
    WHERE a.atttypid <> 'int8'::regtype;
    IF unexpected IS NOT NULL THEN
        RAISE EXCEPTION 'Kolom id pengguna yang bukan bigint: %', unexpected;
    END IF;

    -- Foreign key yang menyentuh kolom yang berubah dilepas dulu, lalu dipasang lagi dari definisinya sendiri tanpa
    -- NOT VALID, jadi setiap baris diperiksa ulang.
    FOR dependent IN
        SELECT format('ALTER TABLE %s DROP CONSTRAINT %I', con.conrelid::regclass, con.conname) AS drop_statement,
            format('ALTER TABLE %s ADD CONSTRAINT %I %s', con.conrelid::regclass, con.conname, pg_get_constraintdef(con.oid)) AS create_statement
        FROM pg_constraint con
        WHERE con.contype = 'f' AND EXISTS (
            SELECT 1 FROM user_id_conversion t
            WHERE (t.relid = con.conrelid AND t.attnum = ANY (con.conkey))
               OR (t.relid = con.confrelid AND t.attnum = ANY (con.confkey)))
        ORDER BY con.conrelid::regclass::text, con.conname
    LOOP
        restore := restore || dependent.create_statement;
        EXECUTE dependent.drop_statement;
    END LOOP;

    -- Satu ALTER TABLE per tabel: setiap tabel ditulis ulang sekali dan index-nya dibangun ulang sekali.
    FOR target IN
        SELECT c.relid::regclass AS table_name,
            string_agg(format('ALTER COLUMN %I TYPE uuid USING public.user_id_to_uuid(%I)', a.attname, a.attname),
                ', ' ORDER BY c.attnum) AS clauses
        FROM user_id_conversion c JOIN pg_attribute a ON a.attrelid = c.relid AND a.attnum = c.attnum
        GROUP BY c.relid ORDER BY 1
    LOOP
        EXECUTE format('ALTER TABLE %s %s', target.table_name, target.clauses);
    END LOOP;

    FOREACH statement IN ARRAY restore LOOP
        EXECUTE statement;
    END LOOP;

    -- ALTER COLUMN TYPE membuang statistik kolom, dan autovacuum tidak menghitung penulisan ulang tabel sebagai
    -- perubahan, jadi tanpa ANALYZE planner menebak sampai ada cukup banyak tulisan baru.
    FOR target IN SELECT DISTINCT relid::regclass AS table_name FROM user_id_conversion LOOP
        EXECUTE format('ANALYZE %s', target.table_name);
    END LOOP;
END $$;

-- Teks dan JSON milik Core yang menyimpan id pengguna, ditemukan database/find-user-ids.sql pada seed CoreERP. Tipe
-- kolom tidak berubah. ALTER COLUMN TYPE menulis ulang isinya tanpa menjalankan trigger, termasuk trigger yang menolak
-- UPDATE pada operator_audit_events dan change_log_entries.
ALTER TABLE public.finance_reference_account_imports
    ALTER COLUMN imported_by_user_id TYPE character varying(64) USING pg_temp.user_id_text(imported_by_user_id);
-- actor_scope berbentuk <sumber>:<id pengguna>, kecuali customer:<id customer> yang sudah uuid.
ALTER TABLE public.tenant_creation_requests
    ALTER COLUMN actor_scope TYPE character varying(100) USING pg_temp.user_id_parts(actor_scope, ':');
ALTER TABLE public.operator_audit_events
    ALTER COLUMN detail TYPE jsonb USING pg_temp.user_ids_in_json(detail, NULL);
-- Nilai lama dan baru field id pengguna, dari tabel mana pun yang perubahannya dicatat.
ALTER TABLE public.change_log_entries
    ALTER COLUMN old_value TYPE text
        USING CASE WHEN pg_temp.user_id_key(field_name) THEN pg_temp.user_id_text(old_value) ELSE old_value END,
    ALTER COLUMN new_value TYPE text
        USING CASE WHEN pg_temp.user_id_key(field_name) THEN pg_temp.user_id_text(new_value) ELSE new_value END;
ANALYZE public.finance_reference_account_imports, public.tenant_creation_requests, public.operator_audit_events,
    public.change_log_entries;

-- Stempel actor audit. Badannya sama dengan 0001 kecuali baris yang ditandai.
CREATE OR REPLACE FUNCTION public.coreerp_stamp_audit_actor() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    -- 0003: dulu bigint; id pengguna kini uuid.
    actor uuid := NULLIF(current_setting('coreerp.user_id', true), '')::uuid;
BEGIN
    IF TG_OP = 'INSERT' THEN
        NEW.created_by_user_id := COALESCE(actor, NEW.created_by_user_id);
        NEW.updated_by_user_id := COALESCE(actor, NEW.updated_by_user_id, NEW.created_by_user_id);
    ELSE
        NEW.created_by_user_id := OLD.created_by_user_id;
        NEW.updated_by_user_id := actor;
    END IF;
    RETURN NEW;
END
$$;

DROP FUNCTION pg_temp.user_ids_in_json(jsonb, text);
DROP FUNCTION pg_temp.user_id_parts(text, text);
DROP FUNCTION pg_temp.user_id_text(text);
DROP FUNCTION pg_temp.user_id_key(text);
