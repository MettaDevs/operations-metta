-- Id CoreERP di kolom teks dan JSON milik module aset menjadi teks uuid. Pasangan Core-nya adalah
-- database/migrations/0002_ids_to_uuid.sql.
--
-- Berkas ini hanya mengubah isi database hasil pemulihan dump CoreERP (bun run migrate --adopt-coreerp). Di sana kolom
-- character(26) tabel aset sudah menjadi uuid oleh 0002 Core, yang berjalan lebih dulu. Yang tersisa adalah teks dan
-- JSON yang menyimpan id, beserta dua trigger function yang mencampur id dengan teks. Di database baru, 0001 module
-- sudah lahir dengan uuid dan function yang sama, dan tabelnya masih kosong, jadi tidak ada yang berubah.

-- Fungsi bantu di pg_temp hanya hidup selama migration ini dan dibuang di akhir berkas.

-- Bagian yang utuh berupa ULID diganti teks uuid; pemisah dan bagian lain tetap. Sama dengan fungsi bernama sama di
-- 0002 Core, yang membuangnya di akhir berkasnya.
CREATE FUNCTION pg_temp.ulid_parts_to_uuid(value text, separators text) RETURNS text
    LANGUAGE sql IMMUTABLE STRICT
    AS $$
    SELECT coalesce(string_agg(
            CASE WHEN m.part[1] ~ '^[0-7][0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{25}$'
                THEN public.ulid_to_uuid(m.part[1])::text ELSE m.part[1] END,
            '' ORDER BY m.n), value)
    FROM regexp_matches(value,
        CASE WHEN separators = '' THEN '^.*$' ELSE '[^' || separators || ']+|[' || separators || ']' END,
        'g') WITH ORDINALITY AS m(part, n)
$$;

-- String ULID di bawah key id, *_id, atau *_ids diganti di teks JSON aslinya, supaya baris yang tidak berubah tetap
-- sama persis dan baris yang berubah tidak ikut dirapikan.
CREATE FUNCTION pg_temp.json_ids_to_uuid(document json) RETURNS json
    LANGUAGE plpgsql IMMUTABLE STRICT
    AS $$
DECLARE
    rewritten text := document::text;
    ulid text;
BEGIN
    FOR ulid IN
        WITH RECURSIVE walk(key, value) AS (
            SELECT NULL::text, document::jsonb
            UNION ALL
            SELECT e.key, e.value
            FROM walk w
            CROSS JOIN LATERAL (
                SELECT o.key, o.value FROM jsonb_each(CASE WHEN jsonb_typeof(w.value) = 'object' THEN w.value END) o
                UNION ALL
                SELECT w.key, a.value FROM jsonb_array_elements(CASE WHEN jsonb_typeof(w.value) = 'array' THEN w.value END) a
            ) e
        )
        SELECT DISTINCT value #>> '{}'
        FROM walk
        WHERE (key = 'id' OR key LIKE '%\_id' OR key LIKE '%\_ids')
          AND jsonb_typeof(value) = 'string'
          AND value #>> '{}' ~ '^[0-7][0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{25}$'
    LOOP
        rewritten := replace(rewritten, '"' || ulid || '"', '"' || public.ulid_to_uuid(ulid) || '"');
    END LOOP;
    RETURN rewritten::json;
END $$;

CREATE FUNCTION pg_temp.posting_ids_to_uuid(posting_ids jsonb) RETURNS jsonb
    LANGUAGE sql IMMUTABLE STRICT
    AS $$
    SELECT CASE WHEN jsonb_typeof(posting_ids) <> 'array' THEN posting_ids ELSE (
        SELECT coalesce(jsonb_agg(CASE WHEN jsonb_typeof(e.value) = 'string'
                THEN to_jsonb(pg_temp.ulid_parts_to_uuid(e.value #>> '{}', '-')) ELSE e.value END
            ORDER BY e.n), '[]'::jsonb)
        FROM jsonb_array_elements(posting_ids) WITH ORDINALITY AS e(value, n)) END
$$;

-- Tipe kolom tidak berubah. ALTER COLUMN TYPE menulis ulang isinya tanpa menjalankan trigger, sama seperti 0002 Core.
ALTER TABLE public.aset_tr_export_penyusutan
    ALTER COLUMN posting_id TYPE character varying(80) USING pg_temp.ulid_parts_to_uuid(posting_id, '-');
ALTER TABLE public.aset_tr_ledger_aset
    ALTER COLUMN source_id TYPE character varying(120) USING pg_temp.ulid_parts_to_uuid(source_id, '');
ALTER TABLE public.aset_tr_pembatalan
    ALTER COLUMN posting_ids TYPE jsonb USING pg_temp.posting_ids_to_uuid(posting_ids);
ALTER TABLE public.aset_tr_penerimaan_aset_details
    ALTER COLUMN atribut TYPE json USING pg_temp.json_ids_to_uuid(atribut),
    ALTER COLUMN saldo_awal_buku TYPE json USING pg_temp.json_ids_to_uuid(saldo_awal_buku);
ALTER TABLE public.aset_tr_penyesuaian_nilai_aset
    ALTER COLUMN posting_id TYPE character varying(120) USING pg_temp.ulid_parts_to_uuid(posting_id, '-');
ALTER TABLE public.aset_tr_penyusutan_aset
    ALTER COLUMN posted_posting_id TYPE character varying(120) USING pg_temp.ulid_parts_to_uuid(posted_posting_id, '-');
ALTER TABLE public.aset_tr_reklasifikasi_aset
    ALTER COLUMN posting_id TYPE character varying(120) USING pg_temp.ulid_parts_to_uuid(posting_id, '-');

-- ALTER COLUMN TYPE membuang statistik kolom, dan autovacuum tidak menghitung penulisan ulang tabel sebagai
-- perubahan, jadi tanpa ANALYZE planner menebak sampai ada cukup banyak tulisan baru.
ANALYZE public.aset_tr_export_penyusutan, public.aset_tr_ledger_aset, public.aset_tr_pembatalan,
    public.aset_tr_penerimaan_aset_details, public.aset_tr_penyesuaian_nilai_aset, public.aset_tr_penyusutan_aset,
    public.aset_tr_reklasifikasi_aset;

-- Trigger function yang mencampur id dengan teks. Badannya sama dengan dump CoreERP kecuali baris yang ditandai.
CREATE OR REPLACE FUNCTION public.aset_capture_book_ledger() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    asset_row aset_tr_aset%ROWTYPE;
    context jsonb := coalesce(nullif(current_setting('coreerp.fa_ledger_context', true), '')::jsonb, '{}'::jsonb);
    acq numeric := 0; acc numeric := 0; wd numeric := 0; ap numeric := 0;
    entry_type text; entry_date date;
BEGIN
    SELECT * INTO STRICT asset_row FROM aset_tr_aset WHERE tenant_id = NEW.tenant_id AND id = NEW.aset_id;
    IF TG_OP = 'INSERT' THEN
        acq := NEW.acquisition_value; acc := NEW.accumulated_depreciation;
        wd := NEW.write_down_amount; ap := NEW.appreciation_amount;
        entry_type := 'acquisition';
    ELSIF OLD.status <> 'closed' AND NEW.status = 'closed' THEN
        acq := -OLD.acquisition_value; acc := -OLD.accumulated_depreciation;
        wd := -OLD.write_down_amount; ap := -OLD.appreciation_amount;
        entry_type := 'disposal';
    ELSE
        acq := NEW.acquisition_value - OLD.acquisition_value;
        acc := NEW.accumulated_depreciation - OLD.accumulated_depreciation;
        wd := NEW.write_down_amount - OLD.write_down_amount;
        ap := NEW.appreciation_amount - OLD.appreciation_amount;
        entry_type := CASE WHEN acq <> 0 THEN 'acquisition_correction'
            WHEN acc <> 0 THEN 'depreciation' WHEN wd <> 0 THEN 'write_down'
            WHEN ap <> 0 THEN 'appreciation' ELSE 'correction' END;
    END IF;
    IF acq = 0 AND acc = 0 AND wd = 0 AND ap = 0 THEN RETURN NEW; END IF;
    entry_type := coalesce(context->>'type', entry_type);
    entry_date := coalesce((context->>'date')::date, NEW.closed_on,
        CASE WHEN TG_OP = 'INSERT' THEN asset_row.acquired_on END, CURRENT_DATE);
    INSERT INTO aset_tr_ledger_aset(id, tenant_id, aset_id, buku_aset_id, buku_id,
        legal_entity_id, responsible_org_unit_id, group_aset_id, asset_code, asset_name,
        book_code, currency_code, posting_date, posting_type, source_type, source_id,
        document_number, description, acquisition_delta, accumulated_delta, write_down_delta,
        appreciation_delta, amount, created_at, updated_at)
    VALUES (gen_random_uuid(), NEW.tenant_id, NEW.aset_id, NEW.id, NEW.buku_id,
        asset_row.legal_entity_id, asset_row.responsible_org_unit_id, asset_row.group_aset_id,
        asset_row.kode, asset_row.nama, NEW.book_code, asset_row.currency_code,
        entry_date, entry_type, coalesce(context->>'source_type', 'asset-book'),
        -- 0002: NEW.id kini uuid, sedangkan source_id tetap teks.
        coalesce(context->>'source_id', NEW.id::text), coalesce(context->>'document_number', asset_row.kode),
        context->>'description', acq, acc, wd, ap, acq - acc - wd + ap, now(), now());
    RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.aset_capture_group_ledger() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    book_row aset_tr_buku_aset%ROWTYPE;
    context jsonb := coalesce(nullif(current_setting('coreerp.fa_ledger_context', true), '')::jsonb, '{}'::jsonb);
    -- 0002: dulu text, yang tidak bisa masuk ke group_aset_id bertipe uuid.
    target_group uuid; multiplier integer;
BEGIN
    IF NEW.group_aset_id IS NOT DISTINCT FROM OLD.group_aset_id THEN RETURN NEW; END IF;
    FOR book_row IN SELECT * FROM aset_tr_buku_aset WHERE tenant_id = NEW.tenant_id AND aset_id = NEW.id AND status = 'active' LOOP
        FOR multiplier IN SELECT unnest(ARRAY[-1,1]) LOOP
            target_group := CASE WHEN multiplier = -1 THEN OLD.group_aset_id ELSE NEW.group_aset_id END;
            INSERT INTO aset_tr_ledger_aset(id, tenant_id, aset_id, buku_aset_id, buku_id,
                legal_entity_id, responsible_org_unit_id, group_aset_id, asset_code, asset_name,
                book_code, currency_code, posting_date, posting_type, source_type, source_id,
                document_number, description, acquisition_delta, accumulated_delta, write_down_delta,
                appreciation_delta, amount, created_at, updated_at)
            VALUES (gen_random_uuid(), NEW.tenant_id, NEW.id, book_row.id, book_row.buku_id,
                NEW.legal_entity_id, NEW.responsible_org_unit_id, target_group, NEW.kode, NEW.nama,
                book_row.book_code, NEW.currency_code, coalesce((context->>'date')::date, CURRENT_DATE),
                -- 0002: NEW.id kini uuid, sedangkan source_id tetap teks.
                'reclassification', coalesce(context->>'source_type', 'asset'), coalesce(context->>'source_id', NEW.id::text),
                coalesce(context->>'document_number', NEW.kode), context->>'description',
                multiplier * book_row.acquisition_value, multiplier * book_row.accumulated_depreciation,
                multiplier * book_row.write_down_amount, multiplier * book_row.appreciation_amount,
                multiplier * book_row.net_book_value, now(), now());
        END LOOP;
    END LOOP;
    RETURN NEW;
END $$;

DROP FUNCTION pg_temp.posting_ids_to_uuid(jsonb);
DROP FUNCTION pg_temp.json_ids_to_uuid(json);
DROP FUNCTION pg_temp.ulid_parts_to_uuid(text, text);
