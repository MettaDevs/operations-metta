-- Pemeriksaan sesudah migration, dipakai CI. Gagal bila masih ada kolom character(26) di public, atau bila pemetaan
-- ULID <-> uuid berbeda dari pustaka lain. Nilai uuid harapan dihitung terpisah dengan ulidToUUID dari paket npm ulid
-- dan dengan dekoder Crockford di Python; keduanya sama.

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
