-- Pemeriksaan sesudah migration, dipakai CI. Gagal bila masih ada kolom character(26) di public, atau bila pemetaan
-- ULID <-> uuid berbeda dari pustaka lain. Nilai uuid harapan dihitung terpisah dengan ulidToUUID dari paket npm ulid
-- dan dengan dekoder Crockford di Python; keduanya sama.
--
-- Bagian kedua gagal bila masih ada kolom bilangan bulat yang memegang id pengguna (aturan database/find-user-ids.sql),
-- teks id pengguna berupa angka, function yang meng-cast coreerp.user_id ke bilangan bulat, atau bila pemetaan id
-- pengguna <-> uuid berbeda dari uuid.UUID(int=n) Python.

DO $$
DECLARE
    leftover text;
    vector record;
    mismatches integer;
BEGIN
    SELECT string_agg(c.relname || '.' || a.attname, ', ') INTO leftover
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped
      AND a.atttypid = 'bpchar'::regtype AND a.atttypmod = 26 + 4;
    IF leftover IS NOT NULL THEN
        RAISE EXCEPTION 'Kolom character(26) masih ada: %', leftover;
    END IF;

    FOR vector IN
        SELECT * FROM (VALUES
            ('01ARZ3NDEKTSV4RRFFQ69G5FAV', '01563e3a-b5d3-d676-4c61-efb99302bd5b'::uuid),
            ('00000000000000000000000000', '00000000-0000-0000-0000-000000000000'::uuid),
            ('7ZZZZZZZZZZZZZZZZZZZZZZZZZ', 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid),
            ('01M6G2RVPJW0ADS6D17DQEW6QX', '01a1a02c-6ed2-e014-dc99-a13b6eee1afd'::uuid)
        ) AS v(ulid, id)
    LOOP
        IF public.ulid_to_uuid(vector.ulid) IS DISTINCT FROM vector.id
            OR public.ulid_to_uuid(lower(vector.ulid)) IS DISTINCT FROM vector.id
            OR public.uuid_to_ulid(vector.id) IS DISTINCT FROM vector.ulid THEN
            RAISE EXCEPTION 'Pemetaan % <-> % salah: ulid_to_uuid memberi %, uuid_to_ulid memberi %',
                vector.ulid, vector.id, public.ulid_to_uuid(vector.ulid), public.uuid_to_ulid(vector.id);
        END IF;
    END LOOP;

    SELECT count(*) INTO mismatches
    FROM (SELECT gen_random_uuid() AS id FROM generate_series(1, 10000)) s
    WHERE public.ulid_to_uuid(public.uuid_to_ulid(s.id)) <> s.id;
    IF mismatches > 0 THEN
        RAISE EXCEPTION '% dari 10000 uuid acak tidak kembali utuh lewat uuid_to_ulid lalu ulid_to_uuid', mismatches;
    END IF;

    -- Karakter pertama di atas 7 berarti lebih dari 128 bit; yang memotongnya diam-diam akan lolos di sini.
    BEGIN
        PERFORM public.ulid_to_uuid('8ZZZZZZZZZZZZZZZZZZZZZZZZZ');
        RAISE EXCEPTION 'ulid_to_uuid menerima ULID di atas 128 bit';
    EXCEPTION WHEN invalid_text_representation THEN
        NULL;
    END;
END $$;

DO $$
DECLARE
    leftover text;
    vector record;
    mismatches integer;
    rejected uuid;
BEGIN
    SELECT string_agg(c.relname || '.' || a.attname, ', ') INTO leftover
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped
      AND a.atttypid IN ('int2'::regtype, 'int4'::regtype, 'int8'::regtype)
      AND ((c.relname = 'users' AND a.attname = 'id')
        OR a.attname = 'user_id' OR a.attname LIKE '%\_user\_id' OR a.attname LIKE '%\_by'
        OR EXISTS (SELECT 1 FROM pg_constraint con WHERE con.contype = 'f' AND con.conrelid = c.oid
            AND con.confrelid = 'public.users'::regclass AND a.attnum = ANY (con.conkey)));
    IF leftover IS NOT NULL THEN
        RAISE EXCEPTION 'Kolom id pengguna bilangan bulat masih ada: %', leftover;
    END IF;

    IF EXISTS (SELECT 1 FROM pg_attribute a JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
            WHERE a.attrelid = 'public.users'::regclass AND a.attname = 'id') THEN
        RAISE EXCEPTION 'users.id masih punya default; id pengguna baru dibuat aplikasi.';
    END IF;

    SELECT string_agg(p.oid::regprocedure::text, ', ') INTO leftover
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosrc ~ 'coreerp\.user_id' AND p.prosrc ~* '::\s*(bigint|int8|integer|int4|int)\M';
    IF leftover IS NOT NULL THEN
        RAISE EXCEPTION 'Function yang meng-cast coreerp.user_id ke bilangan bulat: %', leftover;
    END IF;

    SELECT string_agg(format('%s.%s', c.relname, a.attname), ', ') INTO leftover
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped
      AND a.atttypid IN ('text'::regtype, 'varchar'::regtype, 'bpchar'::regtype)
      AND (a.attname = 'user_id' OR a.attname LIKE '%\_user\_id')
      AND (xpath('/row/count/text()', query_to_xml(format(
            'SELECT count(*) FROM public.%I WHERE %I ~ ''^(0|[1-9][0-9]{0,17})$''', c.relname, a.attname),
            false, false, '')))[1]::text::bigint > 0;
    IF leftover IS NOT NULL THEN
        RAISE EXCEPTION 'Kolom teks id pengguna masih berisi angka: %', leftover;
    END IF;

    -- Nilai harapan dari Python: str(uuid.UUID(int=n)).
    FOR vector IN
        SELECT * FROM (VALUES
            (0::bigint, '00000000-0000-0000-0000-000000000000'::uuid),
            (1, '00000000-0000-0000-0000-000000000001'::uuid),
            (12, '00000000-0000-0000-0000-00000000000c'::uuid),
            (4294967296, '00000000-0000-0000-0000-000100000000'::uuid),
            (9223372036854775807, '00000000-0000-0000-7fff-ffffffffffff'::uuid)
        ) AS v(user_id, id)
    LOOP
        IF public.user_id_to_uuid(vector.user_id) IS DISTINCT FROM vector.id
            OR public.uuid_to_user_id(vector.id) IS DISTINCT FROM vector.user_id THEN
            RAISE EXCEPTION 'Pemetaan id pengguna % <-> % salah: user_id_to_uuid memberi %, uuid_to_user_id memberi %',
                vector.user_id, vector.id, public.user_id_to_uuid(vector.user_id), public.uuid_to_user_id(vector.id);
        END IF;
    END LOOP;

    SELECT count(*) INTO mismatches
    FROM (SELECT (random() * 9.2e18)::bigint AS user_id FROM generate_series(1, 10000)) s
    WHERE public.uuid_to_user_id(public.user_id_to_uuid(s.user_id)) <> s.user_id;
    IF mismatches > 0 THEN
        RAISE EXCEPTION '% dari 10000 id pengguna acak tidak kembali utuh lewat user_id_to_uuid lalu uuid_to_user_id', mismatches;
    END IF;

    BEGIN
        PERFORM public.user_id_to_uuid(-1);
        RAISE EXCEPTION 'user_id_to_uuid menerima id negatif';
    EXCEPTION WHEN numeric_value_out_of_range THEN
        NULL;
    END;
    -- 64 bit atas terisi, dan 64 bit bawah di luar bigint, sama-sama bukan hasil user_id_to_uuid.
    FOREACH rejected IN ARRAY ARRAY['00000000-0000-0001-0000-000000000000', '00000000-0000-0000-8000-000000000000',
            '01a1a02c-6ed2-e014-dc99-a13b6eee1afd']::uuid[] LOOP
        BEGIN
            PERFORM public.uuid_to_user_id(rejected);
            RAISE EXCEPTION 'uuid_to_user_id menerima %', rejected;
        EXCEPTION WHEN invalid_text_representation THEN
            NULL;
        END;
    END LOOP;
END $$;
